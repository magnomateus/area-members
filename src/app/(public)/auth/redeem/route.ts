import { type NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";
import {
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenNotFoundError,
  redeemAccessToken,
} from "@/lib/auth/tokens";

/**
 * GET /auth/redeem?t=<token>
 *
 * Consome o AccessToken, cria a sessão e redireciona para /home. É um Route
 * Handler (não uma page) porque só Route Handlers / Server Actions podem
 * gravar cookies. Erros conhecidos redirecionam para /login?reason=… —
 * a página /login mostra o aviso correspondente.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("t");
  if (!token) {
    return NextResponse.redirect(new URL("/login?reason=invalid", request.url));
  }

  try {
    const user = await redeemAccessToken(token);
    await createSession(user.id);
    return NextResponse.redirect(new URL("/home?first=1", request.url));
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return NextResponse.redirect(new URL("/login?reason=expired", request.url));
    }
    if (error instanceof TokenAlreadyUsedError) {
      return NextResponse.redirect(new URL("/login?reason=used", request.url));
    }
    if (error instanceof TokenNotFoundError) {
      return NextResponse.redirect(new URL("/login?reason=invalid", request.url));
    }
    // Erro inesperado — trata como link inválido (não vaza detalhe).
    console.error(
      "[redeem] erro inesperado:",
      error instanceof Error ? error.message : "desconhecido",
    );
    return NextResponse.redirect(new URL("/login?reason=invalid", request.url));
  }
}
