import type { ReactNode } from "react";

/**
 * Shell centralizado das telas públicas (login, /obrigado, etc.).
 * Mobile-first: largura máx. 400px no mobile, 480px no desktop.
 *
 * Componente apenas de apresentação (sem hooks) — usável tanto em Server
 * Components quanto em Client Components.
 */
export function CenteredCard({
  logoUrl,
  children,
}: {
  logoUrl?: string | null;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-6 sm:max-w-[480px]">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-12 w-auto" />
        ) : null}
        {children}
      </div>
    </main>
  );
}
