import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Session, User } from "lucia";
import { lucia } from "@/lib/auth/lucia";

/**
 * Helpers de sessão sobre o Lucia. Ver ARCHITECTURE.md seção 6.
 *
 * `getSession` é memoizado por request (`cache`) — várias chamadas no mesmo
 * render fazem uma única validação.
 */
type SessionResult = { user: User; session: Session } | { user: null; session: null };

export const getSession = cache(async (): Promise<SessionResult> => {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null;
  if (!sessionId) {
    return { user: null, session: null };
  }

  const result = await lucia.validateSession(sessionId);

  // Renova o cookie quando a sessão foi estendida; limpa quando inválida.
  // Em Server Components `cookies().set()` lança — nesse caso ignoramos
  // (um Route Handler / Server Action posterior fará o set).
  try {
    if (result.session?.fresh) {
      const cookie = lucia.createSessionCookie(result.session.id);
      cookieStore.set(cookie.name, cookie.value, cookie.attributes);
    }
    if (!result.session) {
      const cookie = lucia.createBlankSessionCookie();
      cookieStore.set(cookie.name, cookie.value, cookie.attributes);
    }
  } catch {
    // Contexto somente-leitura (render de Server Component) — esperado.
  }

  return result;
});

/** Retorna o User autenticado ou redireciona para `/login`. */
export async function requireAuth(): Promise<User> {
  const { user } = await getSession();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** Redireciona para `/home` se já houver sessão (uso em páginas públicas de auth). */
export async function requireGuest(): Promise<void> {
  const { user } = await getSession();
  if (user) {
    redirect("/home");
  }
}

/** Cria uma sessão Lucia para o usuário e grava o cookie. */
export async function createSession(userId: string): Promise<void> {
  const session = await lucia.createSession(userId, {});
  const cookie = lucia.createSessionCookie(session.id);
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.attributes);
}

/** Invalida a sessão atual (server-side) e limpa o cookie. */
export async function invalidateSession(): Promise<void> {
  const { session } = await getSession();
  if (session) {
    await lucia.invalidateSession(session.id);
  }
  const cookie = lucia.createBlankSessionCookie();
  const cookieStore = await cookies();
  cookieStore.set(cookie.name, cookie.value, cookie.attributes);
}
