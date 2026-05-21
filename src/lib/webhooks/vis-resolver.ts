import type { Offer, Prisma, Tenant } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * Resolução de tenant e webhook secret a partir do payload da VIS.
 * Ver WEBHOOK_CONTRACT.md seções 3 e 8.
 *
 * Consulta direto no `client` recebido (sem o cache de 60s do
 * `src/lib/tenant/resolver.ts`, que é otimização do proxy/hot-path). O webhook
 * é caminho de baixa frequência — correção e testabilidade (transação
 * injetável) valem mais que o micro-cache aqui.
 */
const SRC_TENANT_REGEX = /^tenant_([a-z0-9-]+)$/;

type DbClient = Prisma.TransactionClient;

/**
 * Resolve o Tenant: `data.tracking.src` (formato `tenant_<slug>`) primeiro,
 * com fallback para `data.products[0].id` → `Offer` → `Tenant`.
 */
export async function resolveTenantFromWebhook(
  payload: VisWebhookPayload,
  client: DbClient = prisma,
): Promise<Tenant | null> {
  const src = payload.data?.tracking?.src;
  if (typeof src === "string") {
    const match = SRC_TENANT_REGEX.exec(src);
    if (match) {
      const tenant = await client.tenant.findUnique({ where: { slug: match[1] } });
      if (tenant) return tenant;
    }
  }

  const firstProductId = payload.data?.products?.[0]?.id;
  if (typeof firstProductId === "number") {
    const offer = await client.offer.findUnique({
      where: { visProductId: firstProductId },
      include: { tenant: true },
    });
    if (offer) return offer.tenant;
  }

  return null;
}

export type SecretResolution =
  | { secret: string; offer: Offer }
  | { secret: null; reason: "no_offer" | "no_secret_configured" };

/**
 * Resolve o webhook secret: percorre `data.products[]` e devolve o primeiro
 * `Offer.visWebhookSecret` não-nulo (a VIS assina o webhook com o secret do
 * produto principal, mas não expõe qual item é o principal — gap conhecido,
 * WEBHOOK_CONTRACT.md seção 5).
 */
export async function resolveWebhookSecret(
  payload: VisWebhookPayload,
  client: DbClient = prisma,
): Promise<SecretResolution> {
  const products = payload.data?.products ?? [];
  let anyOfferFound = false;

  for (const product of products) {
    if (typeof product.id !== "number") continue;
    const offer = await client.offer.findUnique({ where: { visProductId: product.id } });
    if (!offer) continue;
    anyOfferFound = true;
    if (offer.visWebhookSecret) {
      return { secret: offer.visWebhookSecret, offer };
    }
  }

  return { secret: null, reason: anyOfferFound ? "no_secret_configured" : "no_offer" };
}
