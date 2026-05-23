import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContentItemType, type Prisma, OrderStatus, ProductType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ContentAccessDeniedError,
  ContentNotFoundError,
  InvalidContentTypeError,
  getContentSignedUrl,
} from "@/lib/storage/get-content-signed-url";
import { getStoragePath } from "@/lib/storage/local-storage";
import { rollbackRaw, testPrisma } from "../../helpers/db";

/**
 * Testes do core `getContentSignedUrl` (a rota `/api/content/[id]/signed-url`
 * é só uma casca — não exercitável no vitest porque depende de `cookies()`).
 *
 * Cada teste roda numa transação revertida (`rollbackRaw`); o caso de sucesso
 * exige que `storage/files/missa-explicada/ebook.pdf` exista — o `beforeAll`
 * cria um PDF dummy se não estiver lá (fixture de dev).
 */
const SEEDED_PDF_CONTENT_ITEM_ID = "11111111-1111-1111-1111-111111111111";
const SEEDED_PDF_FILE_KEY = "missa-explicada/ebook.pdf";

let tenantId = "";
let ebookProductId = "";

beforeAll(async () => {
  const tenant = await testPrisma.tenant.findUniqueOrThrow({ where: { slug: "missa-explicada" } });
  tenantId = tenant.id;
  const product = await testPrisma.product.findFirstOrThrow({
    where: { tenantId, slug: "ebook-missa-explicada" },
  });
  ebookProductId = product.id;

  // Garante que o ebook.pdf seedado existe no filesystem. Em dev, esse PDF
  // é colocado manualmente; aqui criamos um dummy se ausente para o teste
  // poder rodar mesmo num clone fresco.
  const fullPath = path.join(path.resolve(getStoragePath()), SEEDED_PDF_FILE_KEY);
  try {
    await stat(fullPath);
  } catch {
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, Buffer.from("%PDF-1.4\n%dummy seed fixture\n", "utf8"));
  }
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

function randomVisOrderId(): number {
  return 100_000_000 + Math.floor(Math.random() * 1_900_000_000);
}

async function createUser(tx: Prisma.TransactionClient, forTenantId: string): Promise<string> {
  const user = await tx.user.create({
    data: { tenantId: forTenantId, email: `signed-${randomUUID()}@test.local` },
  });
  return user.id;
}

async function grantEntitlement(
  tx: Prisma.TransactionClient,
  userId: string,
  productId: string,
  forTenantId: string,
): Promise<void> {
  const order = await tx.order.create({
    data: {
      tenantId: forTenantId,
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

describe("getContentSignedUrl", () => {
  it("usuário com entitlement ativo → gera signed URL, Progress e EventLog", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await grantEntitlement(tx, userId, ebookProductId, tenantId);

      const result = await getContentSignedUrl({
        userId,
        tenantId,
        contentItemId: SEEDED_PDF_CONTENT_ITEM_ID,
        client: tx,
      });

      expect(result.url).toMatch(/^\/api\/files\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(result.title).toBe("Missa Explicada — Ebook completo");
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Progress marcado como IN_PROGRESS.
      const progress = await tx.progress.findUnique({
        where: {
          userId_contentItemId: { userId, contentItemId: SEEDED_PDF_CONTENT_ITEM_ID },
        },
      });
      expect(progress?.status).toBe("IN_PROGRESS");

      // EventLog forense content.accessed.
      const event = await tx.eventLog.findFirst({
        where: { type: "content.accessed", userId },
      });
      expect(event).not.toBeNull();
    });
  });

  it("usuário sem entitlement → ContentAccessDeniedError", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await expect(
        getContentSignedUrl({
          userId,
          tenantId,
          contentItemId: SEEDED_PDF_CONTENT_ITEM_ID,
          client: tx,
        }),
      ).rejects.toBeInstanceOf(ContentAccessDeniedError);
    });
  });

  it("contentItem inexistente → ContentNotFoundError", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await expect(
        getContentSignedUrl({ userId, tenantId, contentItemId: randomUUID(), client: tx }),
      ).rejects.toBeInstanceOf(ContentNotFoundError);
    });
  });

  it("contentItem de OUTRO tenant → ContentNotFoundError (isolamento transitivo)", async () => {
    await rollbackRaw(async (tx) => {
      // Outro tenant, com seu próprio Product e ContentItem PDF.
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
      // Pede o item do outro tenant usando o tenant atual → não encontra (não vaza).
      await expect(
        getContentSignedUrl({ userId, tenantId, contentItemId: otherItem.id, client: tx }),
      ).rejects.toBeInstanceOf(ContentNotFoundError);
    });
  });

  it("contentItem sem arquivo (EXTERNAL_LINK) → InvalidContentTypeError", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createUser(tx, tenantId);
      await grantEntitlement(tx, userId, ebookProductId, tenantId);

      const linkItem = await tx.contentItem.create({
        data: {
          productId: ebookProductId,
          type: ContentItemType.EXTERNAL_LINK,
          title: "Link externo",
          externalUrl: "https://example.com",
        },
      });

      await expect(
        getContentSignedUrl({ userId, tenantId, contentItemId: linkItem.id, client: tx }),
      ).rejects.toBeInstanceOf(InvalidContentTypeError);
    });
  });
});
