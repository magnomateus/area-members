import type { ContentItem, Prisma, Product } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Checagem de direitos de acesso (entitlements).
 *
 * Regra canônica — ARCHITECTURE.md seção 7: um usuário tem acesso a um Product
 * se possui um Entitlement com `status = ACTIVE` e que não expirou
 * (`expiresAt` nulo = vitalício, ou no futuro).
 *
 * IMPORTANTE: estas funções NÃO são memoizadas (`cache`). O acesso pode mudar
 * dentro de uma mesma request (revogação, expiração) e nunca deve ser servido
 * de um valor obsoleto.
 */

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * O usuário tem um Entitlement ATIVO e não expirado para este Product?
 */
export async function hasAccess(
  userId: string,
  productId: string,
  client: DbClient = prisma,
): Promise<boolean> {
  const entitlement = await client.entitlement.findFirst({
    where: {
      userId,
      productId,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return entitlement !== null;
}

export interface ContentItemAccess {
  contentItem: ContentItem | null;
  product: Product | null;
  hasAccess: boolean;
}

/**
 * Resolve um ContentItem garantindo que ele pertence a `tenantId` e diz se o
 * usuário tem acesso ao Product que o contém.
 *
 * `ContentItem` não tem coluna `tenantId` — o isolamento é TRANSITIVO via
 * `Product.tenantId`. Por isso a busca é `findFirst` com filtro aninhado
 * `product: { tenantId }` (ver docs/DECISIONS/001, "tabelas tenant-scoped
 * transitivamente"). Um `findUnique({ where: { id } })` vazaria conteúdo de
 * outro tenant.
 *
 * - ContentItem inexistente NESTE tenant → `{ contentItem: null, product: null, hasAccess: false }`.
 * - Existe → busca o Entitlement do usuário e devolve `hasAccess`.
 *
 * O caller decide a semântica:
 * - `contentItem === null` → 404 (não vaza que existe em outro tenant).
 * - `contentItem !== null && !hasAccess` → 403.
 */
export async function hasAccessToContentItem(
  userId: string,
  contentItemId: string,
  tenantId: string,
  client: DbClient = prisma,
): Promise<ContentItemAccess> {
  const found = await client.contentItem.findFirst({
    where: { id: contentItemId, product: { tenantId } },
    include: { product: true },
  });

  if (!found) {
    return { contentItem: null, product: null, hasAccess: false };
  }

  const { product, ...contentItem } = found;
  const access = await hasAccess(userId, product.id, client);
  return { contentItem, product, hasAccess: access };
}

/**
 * Lista os Products que o usuário pode consumir agora — base da home.
 *
 * Considera apenas Entitlements ATIVOS e não expirados e, dentro deles, apenas
 * Products `active`. Products inativos (ex.: Bônus aguardando configuração via
 * Admin) não aparecem pro cliente, mesmo que o user tenha entitlement.
 *
 * Faz dedup por Product — uma re-compra gera vários Entitlements do mesmo
 * Product. Ordena pela concessão mais recente.
 */
export async function listActiveEntitledProducts(
  userId: string,
  client: DbClient = prisma,
): Promise<Product[]> {
  const entitlements = await client.entitlement.findMany({
    where: {
      userId,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      product: { active: true },
    },
    include: { product: true },
    orderBy: { grantedAt: "desc" },
  });

  const seenProductIds = new Set<string>();
  const products: Product[] = [];
  for (const entitlement of entitlements) {
    if (seenProductIds.has(entitlement.productId)) continue;
    seenProductIds.add(entitlement.productId);
    products.push(entitlement.product);
  }
  return products;
}
