import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AdminUser } from "@prisma/client";
import type { Session } from "lucia";
import { adminLucia } from "./auth";
import { type AdminSessionResult, validateAdminSession } from "./session";

/**
 * Proteção das rotas `/admin/*` autenticadas.
 *
 * `resolveAdminAccess` é o core testável (recebe o sessionId direto).
 * `requireAdmin` é o wrapper para uso no layout do dashboard: lê o cookie e
 * redireciona — nunca renderiza conteúdo para quem não é admin ativo.
 */
export type AdminAccess =
  | { status: "ok"; session: Session; adminUser: AdminUser }
  | { status: "no-session" }
  | { status: "inactive" };

/**
 * Core: avalia o acesso a partir de um `sessionId`. Se a sessão é válida mas o
 * `AdminUser` está inativo, a sessão é invalidada na hora.
 */
export async function resolveAdminAccess(sessionId: string | null): Promise<AdminAccess> {
  if (!sessionId) {
    return { status: "no-session" };
  }
  const result = await validateAdminSession(sessionId);
  if (!result) {
    return { status: "no-session" };
  }
  if (!result.adminUser.active) {
    await adminLucia.invalidateSession(result.session.id);
    return { status: "inactive" };
  }
  return { status: "ok", session: result.session, adminUser: result.adminUser };
}

/**
 * Exige um admin ativo. Sem sessão → `/admin/login`; admin inativo →
 * `/admin/login?error=inactive`. Em produção não vaza que `/admin` existe —
 * apenas o redirect. Usar no layout de `/admin/(dashboard)`.
 */
export async function requireAdmin(): Promise<AdminSessionResult> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(adminLucia.sessionCookieName)?.value ?? null;
  const access = await resolveAdminAccess(sessionId);

  if (access.status === "no-session") {
    redirect("/admin/login");
  }
  if (access.status === "inactive") {
    redirect("/admin/login?error=inactive");
  }
  return { session: access.session, adminUser: access.adminUser };
}
