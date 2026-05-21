import { randomUUID } from "node:crypto";
import { type Prisma, ProductType } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ProvisionError, runProvisionSteps } from "@/lib/webhooks/provision";
import type { VisWebhookPayload } from "@/lib/webhooks/types";
import { rollbackRaw, testPrisma } from "../../helpers/db";

afterAll(async () => {
  await testPrisma.$disconnect();
});

function randInt(): number {
  return 100_000_000 + Math.floor(Math.random() * 1_900_000_000);
}

interface Fixture {
  tenantId: string;
  visProductId: number;
  productIds: string[];
}

/** Cria tenant + 1 Offer + N Products ligados (com validityDays) na transação. */
async function makeFixture(
  tx: Prisma.TransactionClient,
  products: { validityDays: number | null }[],
): Promise<Fixture> {
  const tenant = await tx.tenant.create({
    data: { slug: `prov-${randomUUID()}`, name: "Provision Test", branding: {} },
  });
  const visProductId = randInt();
  const offer = await tx.offer.create({
    data: { tenantId: tenant.id, visProductId, name: "Offer", price: "100.00" },
  });
  const productIds: string[] = [];
  for (const spec of products) {
    const product = await tx.product.create({
      data: {
        tenantId: tenant.id,
        name: `P-${randomUUID()}`,
        slug: `p-${randomUUID()}`,
        type: ProductType.EBOOK,
      },
    });
    await tx.offerProduct.create({
      data: { offerId: offer.id, productId: product.id, validityDays: spec.validityDays },
    });
    productIds.push(product.id);
  }
  return { tenantId: tenant.id, visProductId, productIds };
}

function approvedPayload(opts: {
  visOrderId: number;
  productIds: number[];
  email: string;
  name?: string;
  phone?: string;
}): VisWebhookPayload {
  return {
    event: "order.approved",
    data: {
      order_id: opts.visOrderId,
      uuid: `sim-${randomUUID()}`,
      total: 100,
      subtotal: 100,
      discount: 0,
      customer: { email: opts.email, name: opts.name, phone: opts.phone },
      products: opts.productIds.map((id) => ({ id, name: "X", quantity: 1, price: 100 })),
      tracking: { src: null },
      paid_at: new Date().toISOString(),
    },
  };
}

describe("runProvisionSteps", () => {
  it("cria User + Order + OrderItem + Entitlement + AccessToken (happy path)", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: null }]);
      const visOrderId = randInt();
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });

      const result = await runProvisionSteps(
        tx,
        approvedPayload({
          visOrderId,
          productIds: [fx.visProductId],
          email: `c-${randomUUID()}@test.local`,
        }),
        tenant,
      );

      expect(result.wasIdempotent).toBe(false);
      expect(result.entitlementsCreated).toBe(1);
      expect(result.accessToken.length).toBeGreaterThan(0);

      const order = await tx.order.findUniqueOrThrow({ where: { id: result.orderId } });
      expect(order.status).toBe("APPROVED");
      expect(order.provisioned).toBe(true);
      expect(await tx.orderItem.count({ where: { orderId: order.id } })).toBe(1);
      expect(
        await tx.entitlement.count({ where: { sourceOrderId: order.id, status: "ACTIVE" } }),
      ).toBe(1);
      expect(await tx.accessToken.count({ where: { orderId: order.id } })).toBe(1);
    });
  });

  it("é idempotente: 2x o mesmo payload não duplica nada", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: null }]);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });
      const visOrderId = randInt();
      const payload = approvedPayload({
        visOrderId,
        productIds: [fx.visProductId],
        email: `c-${randomUUID()}@test.local`,
      });

      const first = await runProvisionSteps(tx, payload, tenant);
      const second = await runProvisionSteps(tx, payload, tenant);

      expect(first.wasIdempotent).toBe(false);
      expect(second.wasIdempotent).toBe(true);
      expect(await tx.order.count({ where: { visOrderId } })).toBe(1);
      expect(await tx.entitlement.count({ where: { sourceOrderId: first.orderId } })).toBe(1);
    });
  });

  it("faz update silencioso do User (nome/phone do payload mais recente)", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: null }]);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });
      const email = `c-${randomUUID()}@test.local`;
      await tx.user.create({
        data: { tenantId: fx.tenantId, email, name: "Nome Antigo", phone: "+5500000000000" },
      });

      const result = await runProvisionSteps(
        tx,
        approvedPayload({
          visOrderId: randInt(),
          productIds: [fx.visProductId],
          email,
          name: "Nome Novo",
          phone: "5511988887777",
        }),
        tenant,
      );

      const user = await tx.user.findUniqueOrThrow({ where: { id: result.userId } });
      expect(user.name).toBe("Nome Novo");
      expect(user.phone).toBe("+5511988887777"); // normalizado para E.164
    });
  });

  it("validityDays null → Entitlement com expiresAt null (vitalício)", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: null }]);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });
      const result = await runProvisionSteps(
        tx,
        approvedPayload({
          visOrderId: randInt(),
          productIds: [fx.visProductId],
          email: `c-${randomUUID()}@test.local`,
        }),
        tenant,
      );
      const ent = await tx.entitlement.findFirstOrThrow({
        where: { sourceOrderId: result.orderId },
      });
      expect(ent.expiresAt).toBeNull();
    });
  });

  it("validityDays 90 → Entitlement com expiresAt ≈ now + 90 dias", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: 90 }]);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });
      const result = await runProvisionSteps(
        tx,
        approvedPayload({
          visOrderId: randInt(),
          productIds: [fx.visProductId],
          email: `c-${randomUUID()}@test.local`,
        }),
        tenant,
      );
      const ent = await tx.entitlement.findFirstOrThrow({
        where: { sourceOrderId: result.orderId },
      });
      const expiresAt = ent.expiresAt;
      expect(expiresAt).not.toBeNull();
      if (expiresAt !== null) {
        const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(89);
        expect(days).toBeLessThan(91);
      }
    });
  });

  it("deduplica por Product: 2 Offers com o mesmo Product → 1 Entitlement (validade mais generosa)", async () => {
    await rollbackRaw(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug: `prov-${randomUUID()}`, name: "Dedup Test", branding: {} },
      });
      const sharedProduct = await tx.product.create({
        data: {
          tenantId: tenant.id,
          name: "Shared",
          slug: `shared-${randomUUID()}`,
          type: ProductType.EBOOK,
        },
      });
      const offerA = await tx.offer.create({
        data: { tenantId: tenant.id, visProductId: randInt(), name: "A", price: "10.00" },
      });
      const offerB = await tx.offer.create({
        data: { tenantId: tenant.id, visProductId: randInt(), name: "B", price: "10.00" },
      });
      await tx.offerProduct.create({
        data: { offerId: offerA.id, productId: sharedProduct.id, validityDays: 30 },
      });
      await tx.offerProduct.create({
        data: { offerId: offerB.id, productId: sharedProduct.id, validityDays: null },
      });

      const result = await runProvisionSteps(
        tx,
        approvedPayload({
          visOrderId: randInt(),
          productIds: [offerA.visProductId, offerB.visProductId],
          email: `c-${randomUUID()}@test.local`,
        }),
        tenant,
      );

      expect(result.entitlementsCreated).toBe(1);
      const ent = await tx.entitlement.findFirstOrThrow({
        where: { sourceOrderId: result.orderId },
      });
      // 30 dias vs vitalício → vitalício (mais generoso).
      expect(ent.expiresAt).toBeNull();
    });
  });

  it("re-compra: nova compra cria um NOVO Entitlement (preserva histórico)", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: null }]);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });
      const email = `c-${randomUUID()}@test.local`;

      const first = await runProvisionSteps(
        tx,
        approvedPayload({ visOrderId: randInt(), productIds: [fx.visProductId], email }),
        tenant,
      );
      const second = await runProvisionSteps(
        tx,
        approvedPayload({ visOrderId: randInt(), productIds: [fx.visProductId], email }),
        tenant,
      );

      expect(second.userId).toBe(first.userId); // mesmo User
      expect(second.orderId).not.toBe(first.orderId); // Orders distintas
      expect(await tx.entitlement.count({ where: { userId: first.userId } })).toBe(2);
    });
  });

  it("produto desconhecido: loga EventLog e continua provisionando o resto", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: null }]);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });

      const result = await runProvisionSteps(
        tx,
        approvedPayload({
          visOrderId: randInt(),
          productIds: [fx.visProductId, 999_999_001], // 2º produto não tem Offer
          email: `c-${randomUUID()}@test.local`,
        }),
        tenant,
      );

      expect(result.entitlementsCreated).toBe(1); // só o produto conhecido
      const logs = await tx.eventLog.findMany({
        where: { type: "webhook.unknown_product", tenantId: fx.tenantId },
      });
      expect(logs).toHaveLength(1);
    });
  });

  it("payload sem customer.email → ProvisionError", async () => {
    await rollbackRaw(async (tx) => {
      const fx = await makeFixture(tx, [{ validityDays: null }]);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });
      const payload: VisWebhookPayload = {
        event: "order.approved",
        data: { order_id: randInt(), products: [{ id: fx.visProductId }] },
      };
      await expect(runProvisionSteps(tx, payload, tenant)).rejects.toBeInstanceOf(ProvisionError);
    });
  });

  it("rollback: erro no meio da transação reverte tudo", async () => {
    const visOrderId = randInt();
    const email = `rb-${randomUUID()}@test.local`;

    await expect(
      testPrisma.$transaction(async (tx) => {
        const fx = await makeFixture(tx, [{ validityDays: null }]);
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: fx.tenantId } });
        await runProvisionSteps(
          tx,
          approvedPayload({ visOrderId, productIds: [fx.visProductId], email }),
          tenant,
        );
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    // Nada pode ter sido persistido.
    expect(await testPrisma.order.findUnique({ where: { visOrderId } })).toBeNull();
    expect(await testPrisma.user.findFirst({ where: { email } })).toBeNull();
  });
});
