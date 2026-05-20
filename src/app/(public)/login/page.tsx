import { requireTenant } from "@/lib/tenant/context";
import { MagicLinkForm } from "./magic-link-form";

/**
 * Página `/login` — solicitação de magic link.
 *
 * Mobile-first, Tailwind cru. O branding (nome e logo) vem do tenant atual,
 * resolvido pelo proxy. Não há login por senha na Fase 1.
 */
function readBranding(branding: unknown): { appName: string; logoUrl: string | null } {
  const b = (branding ?? {}) as Record<string, unknown>;
  return {
    appName: typeof b.appName === "string" ? b.appName : "Área de Membros",
    logoUrl: typeof b.logoUrl === "string" ? b.logoUrl : null,
  };
}

export default async function LoginPage() {
  const tenant = await requireTenant();
  const branding = readBranding(tenant.branding);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <header className="flex flex-col items-center gap-2 text-center">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.appName} className="h-12 w-auto" />
          ) : null}
          <h1 className="text-xl font-semibold">{branding.appName}</h1>
          <p className="text-sm text-gray-500">Receba seu link de acesso por email e WhatsApp.</p>
        </header>
        <MagicLinkForm />
      </div>
    </main>
  );
}
