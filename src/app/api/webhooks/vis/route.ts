import { type NextRequest, NextResponse } from "next/server";
import { handleVisWebhook } from "@/lib/webhooks/handler";

/**
 * POST /api/webhooks/vis
 *
 * Recebe webhooks da VIS Platform. Lê o RAW body (necessário para o HMAC),
 * delega ao handler core e responde. Erros não tratados → 500 (a VIS retenta).
 * Ver WEBHOOK_CONTRACT.md seção 8.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "corpo da request ilegível" }, { status: 400 });
  }

  try {
    const result = await handleVisWebhook(rawBody, request.headers);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // Erro transitório (banco fora etc.) → 500 para a VIS retentar.
    console.error(
      "[webhook] erro não tratado:",
      error instanceof Error ? error.message : "desconhecido",
    );
    return NextResponse.json({ ok: false, error: "erro interno" }, { status: 500 });
  }
}
