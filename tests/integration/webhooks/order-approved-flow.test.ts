import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as ordersStatusGet } from "@/app/api/orders/status/route";
import { handleVisWebhook } from "@/lib/webhooks/handler";
import { testPrisma } from "../../helpers/db";

/**
 * Fluxo completo order.approved: handler → provision. Estes testes COMITAM no
 * banco (a rota/handler usam o prisma global) — a limpeza é feita no afterAll.
 * Usam o produto DEV de seed (visProductId 99999, secret fake).
 */
const DEV_PRODUCT_ID = 99999;
const DEV_SECRET = "dev-webhook-secret-for-testing-only";

const visOrderId = 100_000_000 + Math.floor(Math.random() * 1_900_000_000);
const customerEmail = `flow-${randomUUID()}@test.local`;
const testStartedAt = new Date();
let tenantId = "";

beforeAll(async () => {
  const tenant = await testPrisma.tenant.findUniqueOrThrow({ where: { slug: "missa-explicada" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  // Limpeza em ordem segura de FK.
  const order = await testPrisma.order.findUnique({ where: { visOrderId } });
  if (order) {
    await testPrisma.accessToken.deleteMany({ where: { orderId: order.id } });
    await testPrisma.entitlement.deleteMany({ where: { sourceOrderId: order.id } });
    await testPrisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await testPrisma.order.delete({ where: { id: order.id } });
  }
  await testPrisma.user.deleteMany({ where: { tenantId, email: customerEmail } });
  await testPrisma.eventLog.deleteMany({
    where: { tenantId, createdAt: { gte: testStartedAt } },
  });
  await testPrisma.webhookDelivery.deleteMany({ where: { createdAt: { gte: testStartedAt } } });
  await testPrisma.$disconnect();
});

function buildApprovedBody(): string {
  return JSON.stringify({
    event: "order.approved",
    timestamp: new Date().toISOString(),
    data: {
      order_id: visOrderId,
      uuid: `flow-${randomUUID()}`,
      total: 197,
      subtotal: 197,
      discount: 0,
      payment_method: "credit_card",
      payment_gateway: "stripe",
      customer: { email: customerEmail, name: "Cliente Fluxo", phone: "5511999990000" },
      products: [{ id: DEV_PRODUCT_ID, name: "Missa Explicada DEV", quantity: 1, price: 197 }],
      tracking: { src: "tenant_missa-explicada" },
      paid_at: new Date().toISOString(),
    },
  });
}

function signV1(rawBody: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", DEV_SECRET).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

describe("fluxo order.approved (handler → provision)", () => {
  it("provisiona User + Order + Entitlements + AccessToken e o polling fica 'ready'", async () => {
    const rawBody = buildApprovedBody();
    const headers = new Headers({
      "content-type": "application/json",
      "x-webhook-event": "order.approved",
      "x-webhook-signature-v1": signV1(rawBody),
      "x-webhook-delivery-id": `flow-${randomUUID()}`,
    });

    const result = await handleVisWebhook(rawBody, headers);

    expect(result.status).toBe(200);
    expect(result.body.action).toBe("provisioned");
    expect(result.body.entitlementsCreated).toBe(3); // ebook + comunidade + bônus
    expect(result.body.accessTokenGenerated).toBe(true);
    // O token NUNCA aparece no response do handler.
    expect(result.body.accessToken).toBeUndefined();

    // Estado no banco.
    const order = await testPrisma.order.findUniqueOrThrow({
      where: { visOrderId },
      include: { user: true, entitlements: true, items: true },
    });
    expect(order.status).toBe("APPROVED");
    expect(order.provisioned).toBe(true);
    expect(order.user.email).toBe(customerEmail);
    expect(order.items).toHaveLength(1);
    expect(order.entitlements).toHaveLength(3);
    expect(order.entitlements.every((e) => e.status === "ACTIVE")).toBe(true);

    const tokens = await testPrisma.accessToken.findMany({ where: { orderId: order.id } });
    expect(tokens).toHaveLength(1);

    const provisionedLog = await testPrisma.eventLog.findFirst({
      where: { type: "order.provisioned", orderId: order.id },
    });
    expect(provisionedLog).not.toBeNull();

    // Polling: GET /api/orders/status → 'ready'.
    const statusRes = await ordersStatusGet(
      new NextRequest(
        `http://localhost:3000/api/orders/status?order_id=${String(visOrderId)}&email=${encodeURIComponent(customerEmail)}`,
        { headers: { "x-forwarded-for": "203.0.113.10" } },
      ),
    );
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as Record<string, unknown>;
    expect(statusBody.status).toBe("ready");
    expect(typeof statusBody.accessToken).toBe("string");
    expect(statusBody.redirectUrl).toBe(`/auth/redeem?t=${String(statusBody.accessToken)}`);
  });

  it("é idempotente: reenviar o mesmo order.approved não duplica", async () => {
    const rawBody = buildApprovedBody();
    const headers = new Headers({
      "content-type": "application/json",
      "x-webhook-event": "order.approved",
      "x-webhook-signature-v1": signV1(rawBody),
      "x-webhook-delivery-id": `flow-dup-${randomUUID()}`,
    });

    const result = await handleVisWebhook(rawBody, headers);

    expect(result.status).toBe(200);
    expect(result.body.action).toBe("already_provisioned");
    // Continua só 1 Order e 3 Entitlements.
    const order = await testPrisma.order.findUniqueOrThrow({
      where: { visOrderId },
      include: { entitlements: true },
    });
    expect(order.entitlements).toHaveLength(3);
  });
});
