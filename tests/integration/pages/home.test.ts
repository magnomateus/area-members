import { randomUUID } from "node:crypto";
import { type Prisma, OrderStatus, ProductType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActiveEntitledProducts } from "@/lib/entitlements/check";
import { rollbackRaw, testPrisma } from "../../helpers/db";

/**
 * Testes da listagem que sustenta a home (`/home`).
 *
 * A home é um Server Component (depende de `cookies()`) — não renderizável no
 * vitest. Testamos `listActiveEntitledProducts`, que é a lógica destacável:
 * garante que Products inativos não aparecem pro cliente mesmo com entitlement.
 */
let tenantId = "";

beforeAll(async () => {
  const tenant = await testPrisma.tenant.findUniqueOrThrow({ where: { slug: "missa-explicada" } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

function randomVisOrderId(): number {
  return 100_000_000 + Math.floor(Math.random() * 1_900_000_000);
}

async function createUser(tx: Prisma.TransactionClient): Promise<string> {
  const user = await tx.user.create({
    data: { tenantId, email: `home-${randomUUID()}@test.local` },
  });
  return user.id;
}

async function createProduct(tx: Prisma.TransactionClient, active: boolean): Promise<string> {
  const product = await tx.product.create({
    data: {
      tenantId,
      name: active ? "Produto Ativo" : "Produto Inativo",
      slug: `produto-${randomUUID()}`,
      type: ProductType.EBOOK,
      active,
    },
  });
  return product.id;
}

async function grantEntitlement(
  tx: Prisma.TransactionClient,
  userId: string,
  productId: string,
): Promise<void> {
  const order = await tx.order.create({
    data: {
      tenantId,
      userId,
      visOrderId: randomVisOrderId(),
      status: OrderStatus.APPROVED,
      amount: 10,
      subtotal: 10,
    },
  });
  await tx.entitlement.create({
    data: { userId, productId, sourceOrderId: order.id, status: "ACTIVE" },
  });
}

describe("listActiveEntitledProducts", () => {
  it("entitlement de Product INATIVO → não aparece na home", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx);
      const inactiveProductId = await createProduct(tx, false);
      await grantEntitlement(tx, userId, inactiveProductId);

      const products = await listActiveEntitledProducts(userId, tx);
      expect(products).toHaveLength(0);
    });
  });

  it("entitlement de Product ativo + inativo → só o ativo aparece", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx);
      const activeProductId = await createProduct(tx, true);
      const inactiveProductId = await createProduct(tx, false);
      await grantEntitlement(tx, userId, activeProductId);
      await grantEntitlement(tx, userId, inactiveProductId);

      const products = await listActiveEntitledProducts(userId, tx);
      expect(products).toHaveLength(1);
      expect(products[0].id).toBe(activeProductId);
    });
  });

  it("dois entitlements do mesmo Product → dedup, aparece uma vez", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx);
      const activeProductId = await createProduct(tx, true);
      await grantEntitlement(tx, userId, activeProductId);
      await grantEntitlement(tx, userId, activeProductId);

      const products = await listActiveEntitledProducts(userId, tx);
      expect(products).toHaveLength(1);
      expect(products[0].id).toBe(activeProductId);
    });
  });
});
