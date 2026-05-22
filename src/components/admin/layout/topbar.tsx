"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/admin/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/admin/ui/sheet";
import { SidebarNav, findActiveNavLabel } from "./sidebar";
import { UserMenu } from "./user-menu";

/**
 * Topbar do admin: título da seção atual + menu de usuário à direita.
 * No mobile, o botão de menu abre a navegação como drawer (Sheet).
 */
export function Topbar({ name, email }: { name: string; email: string }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const title = findActiveNavLabel(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4">
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu">
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="border-b px-5 py-4 text-left text-sm font-semibold">
            Membros VIS · Admin
          </SheetTitle>
          <SidebarNav
            onNavigate={() => {
              setDrawerOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <h1 className="text-sm font-semibold tracking-tight">{title}</h1>

      <div className="ml-auto">
        <UserMenu name={name} email={email} />
      </div>
    </header>
  );
}
