import { cookies } from "next/headers";
import { cache } from "react";
import type { AdminUser } from "@prisma/client";
import type { Session } from "lucia";
import { prisma } from "@/lib/db";
import { adminLucia } from "./auth";

/**
 * Sessão do admin sobre o Lucia (`adminLucia`).
 *
 * `validateAdminSession` é o core testável (recebe o sessionId direto). Os
 * wrappers `getAdminSession`/`createAdminSession`/`invalidateAdminSession`
 * tocam o cookie `admin_session` e só funcionam em contexto de request.
 */
export interface AdminSessionResult {
  session: Session;
  adminUser: AdminUser;
}

/**
 * Core testável: valida um `sessionId` (sem depender de `cookies()`) e
 * re-consulta o `AdminUser` completo — não confia na tipagem de
 * `getUserAttributes` (ver `auth.ts`).
 */
export async function validateAdminSession(sessionId: string): Promise<AdminSessionResult | null> {
  const { session } = await adminLucia.validateSession(sessionId);
  if (!session) {
    return null;
  }
  const adminUser = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!adminUser) {
    return null;
  }
  return { session, adminUser };
}

/**
 * Core: cria a sessão Lucia do admin, grava `ipAddress`/`userAgent` e atualiza
 * `lastLoginAt`. Não toca o cookie — devolve a `Session` para o caller.
 *
 * (ipAddress/userAgent não vão pelo `createSession` do Lucia porque o
 * `DatabaseSessionAttributes` global é vazio — gravamos com um update direto.)
 */
export async function establishAdminSession(
  adminUserId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<Session> {
  const session = await adminLucia.createSession(adminUserId, {});
  await prisma.adminSession.update({
    where: { id: session.id },
    data: { ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
  });
  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: { lastLoginAt: new Date() },
  });
  return session;
}

/** Cria a sessão do admin e grava o cookie `admin_session`. Devolve o id da sessão. */
export async function createAdminSession(
  adminUserId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<string> {
  const session = await establishAdminSession(adminUserId, meta);
  const cookie = adminLucia.createSessionCookie(session.id);
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.attributes);
  return session.id;
}

/**
 * Sessão do admin a partir do cookie `admin_session`. Memoizada por request.
 * Renova o cookie quando a sessão foi estendida; limpa quando inválida.
 */
export const getAdminSession = cache(async (): Promise<AdminSessionResult | null> => {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(adminLucia.sessionCookieName)?.value ?? null;
  if (!sessionId) {
    return null;
  }

  const { session } = await adminLucia.validateSession(sessionId);

  // Em Server Components `cookies().set()` lança — nesse caso ignoramos.
  try {
    if (session?.fresh) {
      const cookie = adminLucia.createSessionCookie(session.id);
      cookieStore.set(cookie.name, cookie.value, cookie.attributes);
    }
    if (!session) {
      const cookie = adminLucia.createBlankSessionCookie();
      cookieStore.set(cookie.name, cookie.value, cookie.attributes);
    }
  } catch {
    // Contexto somente-leitura (render de Server Component) — esperado.
  }

  if (!session) {
    return null;
  }
  const adminUser = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!adminUser) {
    return null;
  }
  return { session, adminUser };
});

/** Invalida a sessão admin atual (server-side) e limpa o cookie. */
export async function invalidateAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(adminLucia.sessionCookieName)?.value ?? null;
  if (sessionId) {
    await adminLucia.invalidateSession(sessionId);
  }
  const cookie = adminLucia.createBlankSessionCookie();
  cookieStore.set(cookie.name, cookie.value, cookie.attributes);
}
