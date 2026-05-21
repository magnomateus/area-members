import {
  EntitlementStatus,
  OrderStatus,
  type Order,
  type Prisma,
  type Tenant,
  type User,
} from "@prisma/client";
import { generateAccessToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { dispatchProvisionNotifications } from "@/lib/notifications";
import type { VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * Provisionamento — transforma um webhook `order.approved` em
 * User + Order + OrderItems + Entitlements + AccessToken.
 *
 * - `runProvisionSteps(tx, ...)` — núcleo testável; roda SEMPRE dentro de uma
 *   transação (recebe o client de transação). Faz só DB ops.
 * - `provision(payload, tenant)` — wrapper de produção: abre a transação e,
 *   após o COMMIT, dispara notificações + grava `order.provisioned`.
 *
 * Ver WEBHOOK_CONTRACT.md seção 8 e ARCHITECTURE.md seções 5 e 7.
 */
const DAY_MS = 86_400_000;

export class ProvisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionError";
  }
}

export interface ProvisionResult {
  userId: string;
  orderId: string;
  user: User;
  order: Order;
  entitlementsCreated: number;
  accessToken: string;
  accessTokenExpiresAt: Date;
  wasIdempotent: boolean;
}

function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? `+${digits}` : null;
}

function normalizeCpf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function trackingStr(tracking: Record<string, unknown>, key: string): string | null {
  const value = tracking[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Combina dois `validityDays`, devolvendo o mais generoso (null = vitalício). */
function moreGenerousValidity(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

/**
 * Núcleo do provisionamento. Roda dentro de uma transação (`tx`). Idempotente
 * por `visOrderId`: se a Order já está APPROVED + provisionada, retorna
 * `wasIdempotent: true` sem recriar nada.
 */
export async function runProvisionSteps(
  tx: Prisma.TransactionClient,
  payload: VisWebhookPayload,
  tenant: Tenant,
): Promise<ProvisionResult> {
  const data = payload.data;
  const visOrderId = data?.order_id;
  const email = data?.customer?.email;

  if (typeof visOrderId !== "number") {
    throw new ProvisionError("payload de order.approved sem `data.order_id` numérico");
  }
  if (typeof email !== "string" || email.trim().length === 0) {
    throw new ProvisionError("payload de order.approved sem `data.customer.email`");
  }
  const normalizedEmail = email.trim().toLowerCase();

  // ── Passo 1: idempotência forte por visOrderId ──
  const existingOrder = await tx.order.findUnique({ where: { visOrderId } });
  if (existingOrder && existingOrder.status === OrderStatus.APPROVED && existingOrder.provisioned) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: existingOrder.userId } });
    const existingToken = await tx.accessToken.findFirst({
      where: { orderId: existingOrder.id },
      orderBy: { createdAt: "desc" },
    });
    return {
      userId: user.id,
      orderId: existingOrder.id,
      user,
      order: existingOrder,
      entitlementsCreated: 0,
      accessToken: existingToken?.token ?? "",
      accessTokenExpiresAt: existingToken?.expiresAt ?? new Date(),
      wasIdempotent: true,
    };
  }

  // ── Passo 2: upsert do User (update silencioso — última compra é a verdade) ──
  const customer = data?.customer ?? {};
  const userFields = {
    name: typeof customer.name === "string" ? customer.name : null,
    phone: normalizePhone(customer.phone),
    cpf: normalizeCpf(customer.cpf),
  };
  const user = await tx.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: normalizedEmail } },
    create: { tenantId: tenant.id, email: normalizedEmail, ...userFields },
    update: userFields,
  });

  // ── Passo 3: upsert da Order ──
  const tracking: Record<string, unknown> = data?.tracking ?? {};
  const orderFields = {
    status: OrderStatus.APPROVED,
    amount: data?.total ?? 0,
    subtotal: data?.subtotal ?? data?.total ?? 0,
    discount: data?.discount ?? 0,
    paymentMethod: typeof data?.payment_method === "string" ? data.payment_method : null,
    paymentGateway: typeof data?.payment_gateway === "string" ? data.payment_gateway : null,
    utmSource: trackingStr(tracking, "utm_source"),
    utmMedium: trackingStr(tracking, "utm_medium"),
    utmCampaign: trackingStr(tracking, "utm_campaign"),
    utmContent: trackingStr(tracking, "utm_content"),
    utmTerm: trackingStr(tracking, "utm_term"),
    src: trackingStr(tracking, "src"),
    sck: trackingStr(tracking, "sck"),
    fbclid: trackingStr(tracking, "fbclid"),
    gclid: trackingStr(tracking, "gclid"),
    ttclid: trackingStr(tracking, "ttclid"),
    clickId: trackingStr(tracking, "click_id"),
    clickSource: trackingStr(tracking, "click_source"),
    paidAt: typeof data?.paid_at === "string" ? new Date(data.paid_at) : null,
  };
  const order = await tx.order.upsert({
    where: { visOrderId },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      visOrderId,
      visOrderUuid: typeof data?.uuid === "string" ? data.uuid : null,
      ...orderFields,
    },
    update: orderFields,
  });

  // ── Passo 4: OrderItems (produto desconhecido NÃO falha a transação) ──
  const products = data?.products ?? [];
  const offerIds: string[] = [];
  for (const product of products) {
    if (typeof product.id !== "number") continue;
    const offer = await tx.offer.findUnique({ where: { visProductId: product.id } });
    if (!offer) {
      await tx.eventLog.create({
        data: {
          tenantId: tenant.id,
          type: "webhook.unknown_product",
          level: "error",
          message: `Produto VIS ${String(product.id)} sem Offer cadastrada — item ignorado.`,
          payload: { visProductId: product.id },
          orderId: order.id,
        },
      });
      continue;
    }
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        offerId: offer.id,
        quantity: product.quantity ?? 1,
        unitPrice: product.price ?? 0,
        isBump: false, // a VIS não expõe is_bump no payload (gap conhecido)
      },
    });
    offerIds.push(offer.id);
  }

  // ── Passo 5: calcula entitlements (dedup por Product, validade mais generosa) ──
  const offerProducts = await tx.offerProduct.findMany({
    where: { offerId: { in: offerIds } },
  });
  const validityByProduct = new Map<string, number | null>();
  for (const op of offerProducts) {
    if (!validityByProduct.has(op.productId)) {
      validityByProduct.set(op.productId, op.validityDays);
    } else {
      const current = validityByProduct.get(op.productId) ?? null;
      validityByProduct.set(op.productId, moreGenerousValidity(current, op.validityDays));
    }
  }

  // ── Passo 6: cria Entitlements (sempre NOVO por compra — preserva histórico) ──
  const now = Date.now();
  let entitlementsCreated = 0;
  for (const [productId, validityDays] of validityByProduct) {
    await tx.entitlement.create({
      data: {
        userId: user.id,
        productId,
        sourceOrderId: order.id,
        status: EntitlementStatus.ACTIVE,
        expiresAt: validityDays === null ? null : new Date(now + validityDays * DAY_MS),
      },
    });
    entitlementsCreated += 1;
  }

  // ── Passo 7: AccessToken (single-use, 15min) ──
  const { token, expiresAt } = await generateAccessToken(user.id, order.id, tx);

  // ── Passo 8: marca a Order como provisionada ──
  const provisionedOrder = await tx.order.update({
    where: { id: order.id },
    data: { provisioned: true, provisionedAt: new Date() },
  });

  return {
    userId: user.id,
    orderId: order.id,
    user,
    order: provisionedOrder,
    entitlementsCreated,
    accessToken: token,
    accessTokenExpiresAt: expiresAt,
    wasIdempotent: false,
  };
}

/**
 * Wrapper de produção. Roda `runProvisionSteps` numa transação atômica e, após
 * o COMMIT, dispara as notificações e grava o `order.provisioned`.
 */
export async function provision(
  payload: VisWebhookPayload,
  tenant: Tenant,
): Promise<ProvisionResult> {
  const result = await prisma.$transaction((tx) => runProvisionSteps(tx, payload, tenant));

  // Fora da transação (já comitada): efeitos colaterais não-críticos.
  if (!result.wasIdempotent) {
    await dispatchProvisionNotifications({
      user: result.user,
      order: result.order,
      tenant,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    });
    await prisma.eventLog.create({
      data: {
        tenantId: tenant.id,
        type: "order.provisioned",
        level: "info",
        message: `Order ${String(result.order.visOrderId)} provisionada — ${String(result.entitlementsCreated)} entitlement(s).`,
        payload: payload as unknown as Prisma.InputJsonValue,
        userId: result.userId,
        orderId: result.orderId,
      },
    });
  }

  return result;
}
