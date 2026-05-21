import type { Tenant } from "@prisma/client";

/**
 * Monta a URL de suporte via WhatsApp (`wa.me`) do tenant.
 *
 * Retorna `null` se o tenant não tem `supportWhatsapp` configurado — a tela
 * que chama decide o fallback (ex.: esconder o botão).
 */
export function buildSupportWhatsappUrl(
  tenant: Tenant,
  orderId?: number,
  customMessage?: string,
): string | null {
  if (!tenant.supportWhatsapp) {
    return null;
  }
  const message =
    customMessage ??
    (orderId === undefined
      ? "Preciso de ajuda"
      : `Preciso de ajuda com meu pedido #${String(orderId)}`);
  return `https://wa.me/${tenant.supportWhatsapp}?text=${encodeURIComponent(message)}`;
}
