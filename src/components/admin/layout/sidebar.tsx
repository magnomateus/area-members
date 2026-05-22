"use client";

import {
  Activity,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  Package,
  Settings,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Navegação do admin. As 9 seções da Fase 5 — só `/admin` tem página real
 * nesta sub-fase; as demais apontam para placeholders.
 */
interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Conteúdo", href: "/admin/products", icon: Package },
  { label: "Vendas", href: "/admin/orders", icon: ShoppingCart },
  { label: "Clientes", href: "/admin/users", icon: Users },
  { label: "Acessos", href: "/admin/entitlements", icon: KeyRound },
  { label: "Templates", href: "/admin/templates", icon: Mail },
  { label: "Métricas", href: "/admin/metrics", icon: TrendingUp },
  { label: "Observability", href: "/admin/webhooks", icon: Activity },
  { label: "Configurações", href: "/admin/settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Rótulo da seção ativa — usado no título da topbar. */
export function findActiveNavLabel(pathname: string): string {
  return ADMIN_NAV.find((item) => isActive(pathname, item.href))?.label ?? "Admin";
}

/** Lista de links — reusada na sidebar fixa (desktop) e no drawer (mobile). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {ADMIN_NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Sidebar fixa à esquerda — visível só no desktop (no mobile vira drawer). */
export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-background md:flex">
      <div className="flex h-14 items-center border-b px-5">
        <span className="text-sm font-semibold tracking-tight">Membros VIS · Admin</span>
      </div>
      <SidebarNav />
    </aside>
  );
}
