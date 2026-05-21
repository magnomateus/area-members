import { randomUUID } from "node:crypto";
import { OrderStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/auth/resend-magic-link/route";
import { withTenantContext } from "@/lib/tenant/context";
import { testPrisma } from "../../helpers/db";

/**
 * Testes do endpoint de reenvio de magic link. Comitam no banco (a rota usa o
 * prisma global); limpeza no afterAll. O tenant é propagado via
 * `withTenantContext` (em vitest, `next/headers` não enxerga a NextRequest).
 */
function randInt(): number {
  return 100_000_000 + Math.floor(Math.random() * 1_900_000_000);
}

let tenantId = "";
let userId = "";
let orderId = "";
const email = `resend-${randomUUID()}@test.local`;
const orderVisId = randInt();
const testStartedAt = new Date();

beforeAll(async () => {
  const tenant = await testPrisma.tenant.findUniqueOrThrow({ where: { slug: "missa-explicada" } });
  tenantId = tenant.id;
  const user = await testPrisma.user.create({ data: { tenantId, email } });
  userId = user.id;
  const order = await testPrisma.order.create({
    data: {
      tenantId,
      userId,
      visOrderId: orderVisId,
      status: OrderStatus.APPROVED,
      amount: 10,
      subtotal: 10,
      provisioned: true,
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await testPrisma.accessToken.deleteMany({ where: { userId } });
  await testPrisma.order.deleteMany({ where: { userId } });
  await testPrisma.eventLog.deleteMany({
    where: { type: { startsWith: "magic_link.res" }, createdAt: { gte: testStartedAt } },
  });
  await testPrisma.user.deleteMany({ where: { id: userId } });
  await testPrisma.$disconnect();
});

function resendRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/auth/resend-magic-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function callResend(body?: unknown): Promise<Response> {
  return withTenantContext(tenantId, () => POST(resendRequest(body)));
}

describe("POST /api/auth/resend-magic-link", () => {
  it("sem body → 400", async () => {
    const res = await callResend();
    expect(res.status).toBe(400);
  });

  it("order_id inexistente → 200 (anti-enumeração)", async () => {
    const res = await callResend({ order_id: randInt(), email });
    expect(res.status).toBe(200);
  });

  it("email não confere com a Order → 200 (anti-enumeração)", async () => {
    const res = await callResend({ order_id: orderVisId, email: "outro@test.local" });
    expect(res.status).toBe(200);
  });

  it("dados válidos → 200, gera AccessToken e grava EventLog magic_link.resent", async () => {
    const tokensBefore = await testPrisma.accessToken.count({ where: { orderId } });
    const res = await callResend({ order_id: orderVisId, email });
    expect(res.status).toBe(200);

    const tokensAfter = await testPrisma.accessToken.count({ where: { orderId } });
    expect(tokensAfter).toBe(tokensBefore + 1);

    const log = await testPrisma.eventLog.findFirst({
      where: { type: "magic_link.resent", orderId },
    });
    expect(log).not.toBeNull();
  });

  it("rate limit: 4 chamadas seguidas do mesmo (order_id, email) → 4ª retorna 429", async () => {
    const rateBody = { order_id: randInt(), email: `rl-${randomUUID()}@test.local` };
    expect((await callResend(rateBody)).status).toBe(200);
    expect((await callResend(rateBody)).status).toBe(200);
    expect((await callResend(rateBody)).status).toBe(200);
    expect((await callResend(rateBody)).status).toBe(429);
  });
});
