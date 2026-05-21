import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasAccess } from "@/lib/entitlements/check";
import { getCurrentTenantId } from "@/lib/tenant/context";
import { ContentItemCard } from "./content-item-card";

/**
 * Página do produto — `/produtos/[slug]`.
 *
 * Lista os ContentItems ativos do Product. O cliente chega aqui pelo card
 * "Acessar" da home. Acesso é re-verificado AQUI (não confia na navegação):
 * Product fora do tenant → 404; sem Entitlement ativo → volta para /home.
 */
type Params = Promise<{ slug: string }>;

export default async function ProdutoPage({ params }: { params: Params }) {
  const { slug } = await params;

  const { user } = await getSession();
  if (!user) return null; // o layout (member) já garante a sessão

  const tenantId = await getCurrentTenantId();
  if (!tenantId) notFound();

  // Filtro explícito por tenant — Product é tenant-scoped (coluna própria).
  const product = await prisma.product.findFirst({
    where: { slug, tenantId, active: true },
    include: {
      contentItems: {
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!product) notFound();

  // Re-verifica o direito de acesso — navegação direta não é confiável.
  if (!(await hasAccess(user.id, product.id))) {
    redirect("/home");
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/home" className="text-sm text-gray-500 underline">
          ← Voltar
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">{product.name}</h1>
        {product.description ? (
          <p className="mt-1 text-sm text-gray-500">{product.description}</p>
        ) : null}
      </div>

      {product.contentItems.length === 0 ? (
        <p className="text-sm text-gray-500">
          Este produto ainda não tem conteúdo disponível. Volte em breve.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {product.contentItems.map((item) => (
            <ContentItemCard
              key={item.id}
              id={item.id}
              type={item.type}
              title={item.title}
              description={item.description}
              externalUrl={item.externalUrl}
              textContent={item.textContent}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
