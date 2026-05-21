import { randomUUID } from "node:crypto";
import { ContentItemType, type Prisma, OrderStatus, ProductType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasAccess, hasAccessToContentItem } from "@/lib/entitlements/check";
import { rollbackRaw, testPrisma } from "../../helpers/db";

/**
 * Testes da camada de autorização que sustenta a página `/produtos/[slug]`.
 *
 * A página é um Server Component que depende de `cookies()`/`headers()` — não
 * renderizável no vitest (coberta pelo teste manual E2E). Aqui testamos o que
 * é destacável: o portão de acesso (`hasAccess`) e a resolução com isolamento
 * transitivo de tenant (`hasAccessToContentItem`), que é a parte sensível.
 */
const SEEDED_PDF_CONTENT_ITEM_ID = "11111111-1111-1111-1111-111111111111";

let tenantId = "";
let ebookProductId = "";

beforeAll(async () => {
  const tenant = await testPrisma.tenant.findUniqueOrThrow({ where: { slug: "missa-explicada" } });
  tenantId = tenant.id;
  const product = await testPrisma.product.findFirstOrThrow({
    where: { tenantId, slug: "ebook-missa-explicada" },
  });
  ebookProductId = product.id;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

function randomVisOrderId(): number {
  return 100_000_000 + Math.floor(Math.random() * 1_900_000_000);
}

async function createUser(tx: Prisma.TransactionClient, forTenantId: string): Promise<string> {
  const user = await tx.user.create({
    data: { tenantId: forTenantId, email: `prod-${randomUUID()}@test.local` },
  });
  return user.id;
}

/** Cria um Entitlement para o usuário; `expiresAt`/`status` configuráveis. */
async function grantEntitlement(
  tx: Prisma.TransactionClient,
  opts: {
    userId: string;
    productId: string;
    forTenantId: string;
    status?: "ACTIVE" | "REVOKED" | "SUSPENDED";
    expiresAt?: Date | null;
  },
): Promise<void> {
  const order = await tx.order.create({
    data: {
      tenantId: opts.forTenantId,
      userId: opts.userId,
      visOrderId: randomVisOrderId(),
      status: OrderStatus.APPROVED,
      amount: 10,
      subtotal: 10,
    },
  });
  await tx.entitlement.create({
    data: {
      userId: opts.userId,
      productId: opts.productId,
      sourceOrderId: order.id,
      status: opts.status ?? "ACTIVE",
      expiresAt: opts.expiresAt ?? null,
    },
  });
}

describe("hasAccess", () => {
  it("true quando há Entitlement ACTIVE vitalício", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await grantEntitlement(tx, { userId, productId: ebookProductId, forTenantId: tenantId });
      expect(await hasAccess(userId, ebookProductId, tx)).toBe(true);
    });
  });

  it("false quando não há Entitlement", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      expect(await hasAccess(userId, ebookProductId, tx)).toBe(false);
    });
  });

  it("false quando o Entitlement expirou", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await grantEntitlement(tx, {
        userId,
        productId: ebookProductId,
        forTenantId: tenantId,
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(await hasAccess(userId, ebookProductId, tx)).toBe(false);
    });
  });

  it("false quando o Entitlement está REVOKED", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await grantEntitlement(tx, {
        userId,
        productId: ebookProductId,
        forTenantId: tenantId,
        status: "REVOKED",
      });
      expect(await hasAccess(userId, ebookProductId, tx)).toBe(false);
    });
  });
});

describe("hasAccessToContentItem", () => {
  it("resolve o ContentItem do tenant e reporta hasAccess true", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await grantEntitlement(tx, { userId, productId: ebookProductId, forTenantId: tenantId });

      const result = await hasAccessToContentItem(userId, SEEDED_PDF_CONTENT_ITEM_ID, tenantId, tx);
      expect(result.contentItem?.id).toBe(SEEDED_PDF_CONTENT_ITEM_ID);
      expect(result.product?.id).toBe(ebookProductId);
      expect(result.hasAccess).toBe(true);
    });
  });

  it("contentItem !== null mas hasAccess false quando não há Entitlement", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      const result = await hasAccessToContentItem(userId, SEEDED_PDF_CONTENT_ITEM_ID, tenantId, tx);
      expect(result.contentItem).not.toBeNull();
      expect(result.hasAccess).toBe(false);
    });
  });

  it("ContentItem de outro tenant → tudo null (isolamento transitivo)", async () => {
    await rollbackRaw(async (tx) => {
      const otherTenant = await tx.tenant.create({
        data: { slug: `other-${randomUUID()}`, name: "Outro Tenant", branding: {} },
      });
      const otherProduct = await tx.product.create({
        data: {
          tenantId: otherTenant.id,
          name: "Ebook do outro",
          slug: "ebook-outro",
          type: ProductType.EBOOK,
        },
      });
      const otherItem = await tx.contentItem.create({
        data: {
          productId: otherProduct.id,
          type: ContentItemType.PDF,
          title: "PDF do outro tenant",
          fileKey: "outro/arquivo.pdf",
        },
      });

      const userId = await createUser(tx, tenantId);
      // Pede o item do outro tenant com o tenant atual.
      const result = await hasAccessToContentItem(userId, otherItem.id, tenantId, tx);
      expect(result.contentItem).toBeNull();
      expect(result.product).toBeNull();
      expect(result.hasAccess).toBe(false);
    });
  });
});
