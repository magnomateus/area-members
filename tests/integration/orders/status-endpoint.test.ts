import { randomUUID } from "node:crypto";
import { OrderStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/orders/status/route";
import { testPrisma } from "../../helpers/db";

/**
 * Testes do endpoint de polling. Cria dados COMITADOS no beforeAll (a rota usa
 * o prisma global) e limpa no afterAll. Cada request usa um IP distinto para
 * não compartilhar o bucket de rate limit — exceto o teste de rate limit.
 */
function randInt(): number {
  return 100_000_000 + Math.floor(Math.random() * 1_900_000_000);
}

const email = `status-${randomUUID()}@test.local`;
const orderReadyVis = randInt();
const orderRefusedVis = randInt();
const orderExpiredVis = randInt();
let userId = "";
let expiredTokenValue = "";

beforeAll(async () => {
  const tenant = await testPrisma.tenant.findUniqueOrThrow({ where: { slug: "missa-explicada" } });
  const user = await testPrisma.user.create({ data: { tenantId: tenant.id, email } });
  userId = user.id;

  const orderReady = await testPrisma.order.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      visOrderId: orderReadyVis,
      status: OrderStatus.APPROVED,
      amount: 10,
      subtotal: 10,
      provisioned: true,
      provisionedAt: new Date(),
    },
  });
  await testPrisma.accessToken.create({
    data: {
      userId: user.id,
      orderId: orderReady.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  await testPrisma.order.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      visOrderId: orderRefusedVis,
      status: OrderStatus.REFUSED,
      amount: 10,
      subtotal: 10,
    },
  });

  const orderExpired = await testPrisma.order.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      visOrderId: orderExpiredVis,
      status: OrderStatus.APPROVED,
      amount: 10,
      subtotal: 10,
      provisioned: true,
      provisionedAt: new Date(),
    },
  });
  expiredTokenValue = randomUUID();
  await testPrisma.accessToken.create({
    data: {
      userId: user.id,
      orderId: orderExpired.id,
      token: expiredTokenValue,
      expiresAt: new Date(Date.now() - 1000), // já expirado
    },
  });
});

afterAll(async () => {
  await testPrisma.accessToken.deleteMany({ where: { userId } });
  await testPrisma.order.deleteMany({ where: { userId } });
  await testPrisma.user.deleteMany({ where: { id: userId } });
  await testPrisma.$disconnect();
});

function statusRequest(
  params: { order_id?: string | number; email?: string },
  ip: string,
): NextRequest {
  const url = new URL("http://localhost:3000/api/orders/status");
  if (params.order_id !== undefined) url.searchParams.set("order_id", String(params.order_id));
  if (params.email !== undefined) url.searchParams.set("email", params.email);
  return new NextRequest(url, { headers: { "x-forwarded-for": ip } });
}

async function statusBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("GET /api/orders/status", () => {
  it("Order inexistente → status 'pending'", async () => {
    const res = await GET(statusRequest({ order_id: randInt(), email }, "203.0.113.1"));
    expect(res.status).toBe(200);
    expect((await statusBody(res)).status).toBe("pending");
  });

  it("email não confere → 'pending' (anti-enumeração)", async () => {
    const res = await GET(
      statusRequest({ order_id: orderReadyVis, email: "errado@test.local" }, "203.0.113.2"),
    );
    expect(res.status).toBe(200);
    expect((await statusBody(res)).status).toBe("pending");
  });

  it("Order APPROVED + provisionada → 'ready' com accessToken", async () => {
    const res = await GET(statusRequest({ order_id: orderReadyVis, email }, "203.0.113.3"));
    expect(res.status).toBe(200);
    const body = await statusBody(res);
    expect(body.status).toBe("ready");
    expect(typeof body.accessToken).toBe("string");
    expect(body.redirectUrl).toBe(`/auth/redeem?t=${String(body.accessToken)}`);
  });

  it("Order REFUSED → 'failed' reason 'refused'", async () => {
    const res = await GET(statusRequest({ order_id: orderRefusedVis, email }, "203.0.113.4"));
    expect(res.status).toBe(200);
    const body = await statusBody(res);
    expect(body.status).toBe("failed");
    expect(body.reason).toBe("refused");
  });

  it("AccessToken expirado → gera um novo e retorna 'ready'", async () => {
    const res = await GET(statusRequest({ order_id: orderExpiredVis, email }, "203.0.113.5"));
    expect(res.status).toBe(200);
    const body = await statusBody(res);
    expect(body.status).toBe("ready");
    expect(typeof body.accessToken).toBe("string");
    expect(body.accessToken).not.toBe(expiredTokenValue); // token novo, não o expirado
  });

  it("rate limit: 30 requests/min/IP — a 31ª retorna 429", async () => {
    const ip = "198.51.100.77";
    for (let i = 0; i < 30; i += 1) {
      const res = await GET(statusRequest({ order_id: orderReadyVis, email }, ip));
      expect(res.status).not.toBe(429);
    }
    const blocked = await GET(statusRequest({ order_id: orderReadyVis, email }, ip));
    expect(blocked.status).toBe(429);
  });
});
