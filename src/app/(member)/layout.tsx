import type { ReactNode } from "react";
import { requireAuth } from "@/lib/auth/session";
import { readBranding } from "@/lib/tenant/branding";
import { requireTenant } from "@/lib/tenant/context";
import { logoutAction } from "./actions";

/**
 * Shell autenticado da área de membros. O `requireAuth()` fica AQUI no layout
 * (não em cada página) — redireciona para /login se não houver sessão.
 * UI mínima nesta sub-fase; o shell completo vem na 1.5.
 */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const user = await requireAuth();
  const tenant = await requireTenant();
  const branding = readBranding(tenant.branding);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.appName} className="h-8 w-auto" />
          ) : (
            <span className="font-semibold text-gray-900">{branding.appName}</span>
          )}
          <div className="flex items-center gap-3 text-sm">
            <span className="max-w-[40vw] truncate text-gray-600">{user.name ?? user.email}</span>
            <form action={logoutAction}>
              <button type="submit" className="font-medium text-gray-500 underline">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
