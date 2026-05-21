import { createHmac, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { handleVisWebhook } from "@/lib/webhooks/handler";
import { rollbackRaw, testPrisma } from "../../helpers/db";

afterAll(async () => {
  await testPrisma.$disconnect();
});

const SECRET = "handler-test-secret-xyz";

function signV1(rawBody: string, secret: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

function makeHeaders(opts: { event: string; signature?: string; deliveryId?: string }): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-webhook-event": opts.event,
  });
  if (opts.signature) headers.set("x-webhook-signature-v1", opts.signature);
  if (opts.deliveryId) headers.set("x-webhook-delivery-id", opts.deliveryId);
  return headers;
}

/** Cria um tenant + offer de teste (dentro da transação revertida). */
async function seedTenantOffer(
  tx: Prisma.TransactionClient,
  opts: { secret: string | null },
): Promise<{ tenantId: string; visProductId: number }> {
  const tenant = await tx.tenant.create({
    data: { slug: `wh-${randomUUID()}`, name: "Webhook Test Tenant", branding: {} },
  });
  const visProductId = 100_000 + Math.floor(Math.random() * 800_000_000);
  await tx.offer.create({
    data: {
      tenantId: tenant.id,
      visProductId,
      name: "Webhook Test Offer",
      price: "10.00",
      visWebhookSecret: opts.secret,
    },
  });
  return { tenantId: tenant.id, visProductId };
}

function buildPayload(opts: { event: string; visProductId: number; orderId?: number }): string {
  return JSON.stringify({
    event: opts.event,
    test: opts.event === "webhook.test",
    timestamp: new Date().toISOString(),
    data: {
      order_id: opts.orderId ?? 0,
      products: [{ id: opts.visProductId, name: "X", quantity: 1, price: 10 }],
      tracking: { src: null },
      customer: { email: "x@test.local" },
    },
  });
}

describe("handleVisWebhook", () => {
  it("webhook.test válido: 200, EventLog, nada provisionado, delivery processed", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await seedTenantOffer(tx, { secret: SECRET });
      const rawBody = buildPayload({ event: "webhook.test", visProductId: fx.visProductId });
      const headers = makeHeaders({ event: "webhook.test", signature: signV1(rawBody, SECRET) });

      const result = await handleVisWebhook(rawBody, headers, { client: tx });

      expect(result.status).toBe(200);
      expect(result.body.ok).toBe(true);
      expect(result.body.event).toBe("webhook.test");
      expect(result.body.signatureValid).toBe(true);

      const deliveries = await tx.webhookDelivery.findMany();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].processed).toBe(true);
      expect(deliveries[0].signatureValid).toBe(true);

      const eventLogs = await tx.eventLog.findMany({ where: { type: "webhook.test.received" } });
      expect(eventLogs).toHaveLength(1);

      // webhook.test NÃO provisiona.
      expect(await tx.order.count()).toBe(0);
      expect(await tx.entitlement.count()).toBe(0);
      expect(await tx.user.findFirst({ where: { email: "x@test.local" } })).toBeNull();
    });
  });

  it("mesmo payload 2x: a segunda vez retorna duplicate", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await seedTenantOffer(tx, { secret: SECRET });
      const rawBody = buildPayload({ event: "webhook.test", visProductId: fx.visProductId });
      const signature = signV1(rawBody, SECRET);

      const first = await handleVisWebhook(
        rawBody,
        makeHeaders({ event: "webhook.test", signature }),
        {
          client: tx,
        },
      );
      const second = await handleVisWebhook(
        rawBody,
        makeHeaders({ event: "webhook.test", signature }),
        {
          client: tx,
        },
      );

      expect(first.body.duplicate).toBeUndefined();
      expect(second.body.duplicate).toBe(true);
      expect(await tx.webhookDelivery.count()).toBe(1);
    });
  });

  it("assinatura inválida: 401 + EventLog webhook.signature_invalid", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await seedTenantOffer(tx, { secret: SECRET });
      const rawBody = buildPayload({ event: "order.approved", visProductId: fx.visProductId });
      const badSignature = signV1(rawBody, "secret-completamente-errado");

      const result = await handleVisWebhook(
        rawBody,
        makeHeaders({ event: "order.approved", signature: badSignature }),
        { client: tx },
      );

      expect(result.status).toBe(401);
      const logs = await tx.eventLog.findMany({ where: { type: "webhook.signature_invalid" } });
      expect(logs).toHaveLength(1);
    });
  });

  it("tenant não resolvível: 400 + EventLog de alerta", async () => {
    await rollbackRaw(async (tx) => {
      const rawBody = buildPayload({ event: "order.approved", visProductId: 777_000_777 });
      const result = await handleVisWebhook(
        rawBody,
        makeHeaders({ event: "order.approved", signature: "t=1,v1=abcd" }),
        { client: tx },
      );

      expect(result.status).toBe(400);
      const logs = await tx.eventLog.findMany({ where: { type: "webhook.tenant_unresolved" } });
      expect(logs).toHaveLength(1);
    });
  });

  it("evento desconhecido: 200 + action unknown_event + log warn", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await seedTenantOffer(tx, { secret: SECRET });
      const rawBody = buildPayload({ event: "algo.desconhecido", visProductId: fx.visProductId });
      const result = await handleVisWebhook(
        rawBody,
        makeHeaders({ event: "algo.desconhecido", signature: signV1(rawBody, SECRET) }),
        { client: tx },
      );

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("unknown_event");
      const logs = await tx.eventLog.findMany({ where: { type: "webhook.algo.desconhecido" } });
      expect(logs[0]?.level).toBe("warn");
    });
  });

  it("order.approved na 1.3a: 200, logged_only, sem provisionar", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await seedTenantOffer(tx, { secret: SECRET });
      const rawBody = buildPayload({
        event: "order.approved",
        visProductId: fx.visProductId,
        orderId: 555_001,
      });
      const result = await handleVisWebhook(
        rawBody,
        makeHeaders({ event: "order.approved", signature: signV1(rawBody, SECRET) }),
        { client: tx },
      );

      expect(result.status).toBe(200);
      expect(result.body.action).toBe("logged_only");
      expect(await tx.order.count()).toBe(0);
      expect(await tx.user.findFirst({ where: { email: "x@test.local" } })).toBeNull();
    });
  });
});
