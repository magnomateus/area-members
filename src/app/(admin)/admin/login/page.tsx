import { AdminLoginForm } from "./login-form";

/**
 * Página de login do admin — `/admin/login`.
 *
 * `?error=…` vem dos redirects de `/admin/auth/redeem` (link expirado/usado/
 * inválido) e de `requireAdmin()` (admin inativo).
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ERROR_MESSAGES: Record<string, string> = {
  expired: "Seu link de acesso expirou. Solicite um novo abaixo.",
  used: "Este link de acesso já foi utilizado. Solicite um novo abaixo.",
  invalid: "Link de acesso inválido. Solicite um novo abaixo.",
  inactive: "Sua conta de administrador está inativa. Procure o suporte.",
};

export default async function AdminLoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : null;
  const errorMessage = errorKey ? (ERROR_MESSAGES[errorKey] ?? null) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <AdminLoginForm errorMessage={errorMessage} />
      </div>
    </div>
  );
}
