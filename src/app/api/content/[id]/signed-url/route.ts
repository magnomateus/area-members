import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  ContentAccessDeniedError,
  ContentNotFoundError,
  InvalidContentTypeError,
  RateLimitError,
  getContentSignedUrl,
} from "@/lib/storage/get-content-signed-url";
import { getCurrentTenantId } from "@/lib/tenant/context";

/**
 * GET /api/content/[id]/signed-url
 *
 * Gera uma signed URL (15 min) para o cliente autenticado baixar o arquivo de
 * um ContentItem ao qual ele tem direito. Rota FINA: autentica, resolve o
 * tenant e delega para o core `getContentSignedUrl`; só traduz erros para JSON.
 *
 * Respostas de erro seguem `{ error: { code, message } }` — sem stack trace,
 * sem detalhe técnico exposto.
 */

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // 401 — sem sessão. Em /api/* respondemos JSON (nunca redirect).
  const { user } = await getSession();
  if (!user) {
    return errorResponse("UNAUTHENTICATED", "Login required", 401);
  }

  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    return errorResponse("INTERNAL_ERROR", "Tenant não resolvido.", 500);
  }

  const { id } = await params;

  try {
    const result = await getContentSignedUrl({ userId: user.id, tenantId, contentItemId: id });
    return NextResponse.json({
      url: result.url,
      expiresAt: result.expiresAt.toISOString(),
      title: result.title,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return errorResponse("RATE_LIMITED", "Muitas solicitações. Aguarde um minuto.", 429);
    }
    if (error instanceof ContentNotFoundError) {
      return errorResponse("CONTENT_NOT_FOUND", "Conteúdo não encontrado.", 404);
    }
    if (error instanceof ContentAccessDeniedError) {
      return errorResponse("FORBIDDEN_NO_ACCESS", "Você não tem acesso a este conteúdo.", 403);
    }
    if (error instanceof InvalidContentTypeError) {
      return errorResponse(
        "INVALID_CONTENT_TYPE",
        "Este conteúdo não é um arquivo para download.",
        400,
      );
    }
    // StorageObjectNotFoundError / StorageError / qualquer inesperado → 500.
    // O core já registrou EventLog level=error quando o arquivo sumiu do storage.
    console.error(
      "[signed-url] erro inesperado:",
      error instanceof Error ? error.name : "desconhecido",
    );
    return errorResponse("INTERNAL_ERROR", "Não foi possível preparar o download.", 500);
  }
}
