import { OrderStatus, type Prisma, type Tenant } from "@prisma/client";
import { ProvisionError, provision } from "@/lib/webhooks/provision";
import type { VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * Roteamento por evento do webhook.
 *
 * `order.approved` provisiona (1.3b). `order.refused/cancelled/refunded/
 * chargedback` ainda são stubs — atualizam status de uma Order existente,
 * nunca criam; `suspend()` é fase futura. Ver WEBHOOK_CONTRACT.md seção 7.
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
  userId?: string;
  orderId?: string;
  entitlementsCreated?: number;
  accessTokenGenerated?: boolean;
}

const ORDER_STATUS_EVENTS: Record<string, OrderStatus> = {
  "order.refused": OrderStatus.REFUSED,
  "order.cancelled": OrderStatus.CANCELLED,
  "order.refunded": OrderStatus.REFUNDED,
  "order.chargedback": OrderStatus.CHARGEDBACK,
};

export async function routeWebhookEvent(ctx: RouteContext): Promise<RouteResult> {
  const event = ctx.payload.event ?? "unknown";

  // order.approved → provisionamento completo (1.3b).
  if (event === "order.approved") {
    try {
      const result = await provision(ctx.payload, ctx.tenant);
      return {
        processed: true,
        action: result.wasIdempotent ? "already_provisioned" : "provisioned",
        note: result.wasIdempotent
          ? "Order já estava provisionada — nada recriado"
          : `${String(result.entitlementsCreated)} entitlement(s) criado(s)`,
        logLevel: "info",
        userId: result.userId,
        orderId: result.orderId,
        entitlementsCreated: result.entitlementsCreated,
        // O token NUNCA vai no response — só sinalizamos que foi gerado.
        accessTokenGenerated: !result.wasIdempotent,
      };
    } catch (error) {
      if (error instanceof ProvisionError) {
        // Dados inconsistentes no payload — permanente, não adianta retentar.
        return {
          processed: true,
          action: "provision_failed",
          note: error.message,
          logLevel: "error",
        };
      }
      throw error; // erro transitório (banco) → propaga → handler responde 500
    }
  }

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
          note: `Order ${String(orderId)} → ${targetStatus}`,
          logLevel: event === "order.chargedback" ? "warn" : "info",
        };
      }
    }
    return {
      processed: true,
      action: "order_not_found",
      note: "Order inexistente — nada a atualizar (suspend() é fase futura)",
      logLevel: event === "order.chargedback" ? "warn" : "info",
    };
  }

  if (event === "order.created") {
    return {
      processed: true,
      action: "logged_only",
      note: "order.created não provisiona; criar Order CREATED é fase futura",
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
