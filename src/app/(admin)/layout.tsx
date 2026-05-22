import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/admin/ui/sonner";

/**
 * Shell externo do admin — envolve `/admin/login` e todo o `/admin/*`.
 * Não autentica (isso é do layout interno do dashboard). Só monta o
 * container de toasts (sonner) disponível para todas as telas do admin.
 */
export const metadata: Metadata = {
  title: "Admin · Plataforma de Membros VIS",
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
