import type { Order, Tenant, User } from "@prisma/client";
import { buildRedeemUrl } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";

/**
 * Notificações pós-provisionamento — STUBS (sub-fase 1.3b).
 *
 * O envio real (WhatsApp via Evolution API, email via Resend) chega na 1.6.
 * Por ora: registra `notification.queued` em EventLog e, em dev, imprime o
 * magic link no console. A interface (assinaturas) não muda quando a 1.6
 * substituir o corpo destas funções.
 */
function appBaseUrl(tenant: Tenant): string {
  if (process.env.NODE_ENV === "production" && tenant.domain) {
    return `https://${tenant.domain}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Monta a URL do magic link (`/auth/redeem?t=<token>`) para o tenant. */
export function buildMagicLinkUrl(tenant: Tenant, token: string): string {
  return buildRedeemUrl(token, appBaseUrl(tenant));
}

export interface ProvisionNotificationArgs {
  user: User;
  order: Order;
  tenant: Tenant;
  accessToken: string;
  accessTokenExpiresAt: Date;
}

/**
 * Enfileira (stub) as notificações de acesso após o provisionamento.
 * Registra um `notification.queued` por canal; em dev, loga o magic link.
 */
export async function dispatchProvisionNotifications(
  args: ProvisionNotificationArgs,
): Promise<void> {
  const magicLinkUrl = buildMagicLinkUrl(args.tenant, args.accessToken);

  for (const channel of ["whatsapp", "email"] as const) {
    await prisma.eventLog.create({
      data: {
        tenantId: args.tenant.id,
        type: "notification.queued",
        level: "info",
        message: `Notificação '${channel}' enfileirada (order ${String(args.order.visOrderId)}).`,
        payload: { channel, userId: args.user.id, orderId: args.order.id },
        userId: args.user.id,
        orderId: args.order.id,
      },
    });
  }

  // Magic link no console APENAS em dev — em produção vazaria nos logs da Vercel.
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[NOTIFICATION STUB] WhatsApp: ${args.user.phone ?? "(sem telefone)"} -> ${magicLinkUrl}`,
    );
    console.log(`[NOTIFICATION STUB] Email: ${args.user.email} -> ${magicLinkUrl}`);
  }
}
