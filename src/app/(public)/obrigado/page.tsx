import type { Metadata } from "next";
import { CenteredCard } from "@/components/public/centered-card";
import { buildSupportWhatsappUrl } from "@/lib/support/whatsapp";
import { readBranding } from "@/lib/tenant/branding";
import { requireTenant } from "@/lib/tenant/context";
import { PollingScreen } from "./polling-screen";

/**
 * Página /obrigado — pública (cliente ainda sem sessão). Faz polling do
 * provisionamento e redireciona para o magic link quando pronto.
 */
export const metadata: Metadata = {
  title: "Liberando seu acesso...",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ObrigadoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const orderIdRaw = typeof params.order_id === "string" ? params.order_id : null;
  const email = typeof params.email === "string" ? params.email : null;

  const tenant = await requireTenant();
  const branding = readBranding(tenant.branding);

  const orderId = orderIdRaw === null ? Number.NaN : Number.parseInt(orderIdRaw, 10);
  if (email === null || !Number.isFinite(orderId) || orderId <= 0) {
    return (
      <CenteredCard logoUrl={branding.logoUrl}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Link incompleto</h1>
          <p className="text-sm text-gray-500">
            Não conseguimos identificar seu pedido. Verifique o link que você recebeu por email ou
            WhatsApp.
          </p>
        </div>
      </CenteredCard>
    );
  }

  return (
    <PollingScreen
      orderId={orderId}
      email={email}
      logoUrl={branding.logoUrl}
      supportWhatsappUrl={buildSupportWhatsappUrl(tenant, orderId)}
    />
  );
}
