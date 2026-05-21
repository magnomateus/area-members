import { OrderStatus, type Prisma, type Tenant } from "@prisma/client";
import type { VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * Roteamento por evento do webhook.
 *
 * Na sub-fase 1.3a NÃO há provisionamento. Os handlers de evento apenas
 * sinalizam a ação; quem grava o EventLog é o handler core. Eventos de mudança
 * de status atualizam uma Order **se ela já existir** — nunca criam (criar Order
 * é provisionamento, 1.3b). Ver WEBHOOK_CONTRACT.md seção 7.
 *
 * `webhook.test` NÃO passa por aqui — tem caminho próprio no handler core.
 */
type DbClient = Prisma.TransactionClient;

export interface RouteContext {
  payload: VisWebhookPayload;
  tenant: Tenant;
  client: DbClient;
}

export interface RouteResult {
  processed: true;
  action: string;
  note: string;
  logLevel: "info" | "warn" | "error";
}

const ORDER_STATUS_EVENTS: Record<string, OrderStatus> = {
  "order.refused": OrderStatus.REFUSED,
  "order.cancelled": OrderStatus.CANCELLED,
  "order.refunded": OrderStatus.REFUNDED,
  "order.chargedback": OrderStatus.CHARGEDBACK,
};

export async function routeWebhookEvent(ctx: RouteContext): Promise<RouteResult> {
  const event = ctx.payload.event ?? "unknown";

  // Eventos que atualizam status de uma Order existente (nunca criam).
  const targetStatus = ORDER_STATUS_EVENTS[event];
  if (targetStatus) {
    const orderId = ctx.payload.data?.order_id;
    if (typeof orderId === "number" && orderId > 0) {
      const updated = await ctx.client.order.updateMany({
        where: { visOrderId: orderId, tenantId: ctx.tenant.id },
        data: { status: targetStatus },
      });
      if (updated.count > 0) {
        return {
          processed: true,
          action: "order_status_updated",
          note: `Order ${orderId} → ${targetStatus}`,
          logLevel: event === "order.chargedback" ? "warn" : "info",
        };
      }
    }
    return {
      processed: true,
      action: "order_not_found",
      note: "Order inexistente — nada a atualizar (provisionamento vem na 1.3b)",
      logLevel: event === "order.chargedback" ? "warn" : "info",
    };
  }

  if (event === "order.created" || event === "order.approved") {
    return {
      processed: true,
      action: "logged_only",
      note: "provisionamento vem na 1.3b",
      logLevel: "info",
    };
  }

  if (event.startsWith("subscription.")) {
    return {
      processed: true,
      action: "logged_only",
      note: "subscriptions são fase futura",
      logLevel: "info",
    };
  }

  if (event === "access.granted" || event === "access.revoked") {
    return {
      processed: true,
      action: "logged_only",
      note: "access.* — apenas log na Fase 1",
      logLevel: "info",
    };
  }

  return {
    processed: true,
    action: "unknown_event",
    note: `evento não roteado: ${event}`,
    logLevel: "warn",
  };
}
