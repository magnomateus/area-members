import { CenteredCard } from "@/components/public/centered-card";
import { readBranding } from "@/lib/tenant/branding";
import { requireTenant } from "@/lib/tenant/context";
import { MagicLinkForm } from "./magic-link-form";

/**
 * Página `/login` — solicitação de magic link.
 *
 * Aceita `?email=` (pré-preenche o input) e `?reason=` (mostra um aviso —
 * usado quando o /auth/redeem cai aqui por link expirado/usado/inválido).
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : null;
  const email = typeof params.email === "string" ? params.email : "";

  const tenant = await requireTenant();
  const branding = readBranding(tenant.branding);

  return (
    <CenteredCard logoUrl={branding.logoUrl}>
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-xl font-semibold text-gray-900">{branding.appName}</h1>
        <p className="text-sm text-gray-500">Receba seu link de acesso por email e WhatsApp.</p>
      </header>
      <MagicLinkForm defaultEmail={email} reason={reason} />
    </CenteredCard>
  );
}
