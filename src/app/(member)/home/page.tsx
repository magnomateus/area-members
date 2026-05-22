import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { listActiveEntitledProducts } from "@/lib/entitlements/check";
import { WelcomeModal } from "./welcome-modal";

/**
 * Home da área de membros. Lista os Products que o usuário tem direito de
 * consumir — Entitlement ACTIVE não expirado e Product ativo.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const isFirstAccess = params.first === "1";

  // O layout (member) já garante a sessão; aqui apenas lemos o usuário.
  const { user } = await getSession();
  if (!user) return null;

  // Products inativos (ex: Bônus aguardando configuração via Admin)
  // não aparecem pro cliente, mesmo se o user tiver entitlement.
  const products = await listActiveEntitledProducts(user.id);

  return (
    <>
      {isFirstAccess ? <WelcomeModal userName={user.name} /> : null}

      <h1 className="text-xl font-semibold text-gray-900">Sua área de membros</h1>

      {products.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          Você ainda não tem produtos. Em breve teremos novidades pra você.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {products.map((product) => (
            <li key={product.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-medium text-gray-900">{product.name}</span>
                  <span className="text-xs uppercase tracking-wide text-gray-400">
                    {product.type}
                  </span>
                </div>
                <Link
                  href={`/produtos/${product.slug}`}
                  className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
                >
                  Acessar
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
