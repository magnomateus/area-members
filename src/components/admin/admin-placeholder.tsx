import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui/card";

/**
 * Placeholder de seção do admin ainda não construída. As 8 seções além do
 * Dashboard usam isto na Sub-fase 5.0 — cada uma é entregue numa sub-fase
 * posterior da Fase 5 (ver docs/PHASES.md).
 */
export function AdminPlaceholder({ section, subPhase }: { section: string; subPhase: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section}</CardTitle>
        <CardDescription>Seção em construção.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Esta seção será construída na Sub-fase {subPhase} da Fase 5. Consulte
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">docs/PHASES.md</code>
          para o escopo detalhado.
        </p>
      </CardContent>
    </Card>
  );
}
