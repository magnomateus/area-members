import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestMagicLink } from "@/lib/auth/magic-link";

/**
 * POST /api/auth/magic-link
 *
 * Recebe { email }, dispara o fluxo de magic link e responde sempre com a
 * mesma mensagem genérica (anti-enumeração). 429 quando o IP estoura o rate
 * limit. O tenant é resolvido pelo header X-Tenant-Id (proxy).
 */
const bodySchema = z.object({ email: z.string().email() });

const GENERIC_MESSAGE =
  "Se este email estiver cadastrado, enviamos o link de acesso para seu WhatsApp e email.";

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email inválido." }, { status: 400 });
  }

  const result = await requestMagicLink({
    email: parsed.data.email,
    ip: clientIp(request),
    baseUrl: request.nextUrl.origin,
  });

  if (result.status === "rate_limited") {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
      { status: 429 },
    );
  }

  return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
}
