import type { ReactNode } from "react";
import { Sidebar } from "@/components/admin/layout/sidebar";
import { Topbar } from "@/components/admin/layout/topbar";
import { requireAdmin } from "@/lib/admin/middleware";

/**
 * Layout das telas autenticadas do admin (`/admin`, `/admin/products`, …).
 *
 * `requireAdmin()` fica AQUI — uma única porta: sem sessão → `/admin/login`,
 * admin inativo → `/admin/login?error=inactive`. As páginas filhas não
 * precisam reautenticar.
 */
export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const { adminUser } = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-muted/40">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={adminUser.name ?? adminUser.email} email={adminUser.email} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
