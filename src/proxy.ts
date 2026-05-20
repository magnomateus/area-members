import { type NextRequest, NextResponse } from "next/server";
import { TENANT_HEADER } from "@/lib/tenant/context";
import { resolveTenantByDomain, resolveTenantBySlug } from "@/lib/tenant/resolver";

/**
 * Proxy de resolução de tenant — convenção `proxy.ts` do Next 16, sucessora de
 * `middleware.ts`.
 *
 * - Dev: resolve pelo env `DEV_TENANT_SLUG`.
 * - Prod: resolve pelo hostname da request (`Tenant.domain`).
 * - Tenant inexistente → 404.
 * - Injeta o header `X-Tenant-Id` na request (sobrescreve qualquer valor vindo
 *   do cliente — anti-spoofing).
 *
 * A convenção `proxy.ts` roda em Node.js runtime por padrão (não precisa
 * declarar `runtime`) — necessário para o Prisma e o `AsyncLocalStorage`.
 * Ver ARCHITECTURE.md seção 9.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isProd = process.env.NODE_ENV === "production";

  let tenant = null;
  if (isProd) {
    const host = request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
    if (host) {
      tenant = await resolveTenantByDomain(host);
    }
  } else {
    const slug = process.env.DEV_TENANT_SLUG;
    if (slug) {
      tenant = await resolveTenantBySlug(slug);
    }
  }

  if (!tenant) {
    return new NextResponse("Tenant não encontrado.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TENANT_HEADER, tenant.id);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Roda em tudo, menos assets estáticos do Next. Inclui /api (precisam de tenant).
  // O proxy.ts do Next 16 roda sempre em Node.js runtime — `runtime` não é declarado.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
