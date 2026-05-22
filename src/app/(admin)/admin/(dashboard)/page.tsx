import { Card, CardDescription, CardHeader, CardTitle } from "@/components/admin/ui/card";
import { getAdminSession } from "@/lib/admin/session";

/**
 * Dashboard inicial do admin — `/admin`.
 *
 * Placeholder nesta sub-fase: os números reais chegam na Sub-fase 5.7
 * (Métricas). O layout já garantiu a sessão via `requireAdmin()`.
 */
const PLACEHOLDER_STATS = [
  { label: "Total de vendas", hint: "Sub-fase 5.7" },
  { label: "Clientes ativos", hint: "Sub-fase 5.7" },
  { label: "Webhooks (24h)", hint: "Sub-fase 5.6" },
];

export default async function AdminDashboardPage() {
  const session = await getAdminSession();
  const name = session?.adminUser.name ?? session?.adminUser.email ?? "administrador";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Bem-vindo, {name}</h2>
        <p className="text-sm text-muted-foreground">
          Painel administrativo da Plataforma de Membros VIS.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLACEHOLDER_STATS.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums text-muted-foreground">—</CardTitle>
              <CardDescription className="text-xs">Disponível na {stat.hint}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Esta página será preenchida na Sub-fase 5.7 (Métricas).
      </p>
    </div>
  );
}
