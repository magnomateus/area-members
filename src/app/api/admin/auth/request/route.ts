import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logAdminAction } from "@/lib/admin/audit";
import { buildAdminRedeemUrl, createAdminMagicLink } from "@/lib/admin/magic-link";
import { prisma } from "@/lib/db";

/**
 * POST /api/admin/auth/request
 *
 * Solicita um magic link de admin. Responde SEMPRE 200 com a mesma mensagem
 * genérica (anti-enumeração) — não revela se o email é de um admin.
 * Rate limit: 5 requests / 15 min / IP. Ver docs/PHASES.md "Sub-fase 5.0".
 *
 * Envio real (Resend) chega na Fase 1.6 — aqui o link é impresso no console.
 */
const bodySchema = z.object({ email: z.string().email() });

const GENERIC_MESSAGE = "Se este email for de um administrador, o link de acesso foi enviado.";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const CONSTANT_RESPONSE_MS = 250;

const ipAttempts = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (ipAttempts.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    ipAttempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipAttempts.set(ip, recent);
  return false;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

async function padConstantTime(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < CONSTANT_RESPONSE_MS) {
    await new Promise((resolve) => setTimeout(resolve, CONSTANT_RESPONSE_MS - elapsed));
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
      { status: 429 },
    );
  }

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

  const startedAt = Date.now();
  const email = parsed.data.email.trim().toLowerCase();
  const admin = await prisma.adminUser.findUnique({ where: { email } });

  // Só gera o link para admin existente E ativo. Admin inativo é tratado como
  // inexistente (sem link), mas a tentativa é auditada.
  if (admin?.active) {
    const { token } = await createAdminMagicLink(admin.id);
    const redeemUrl = buildAdminRedeemUrl(token, request.nextUrl.origin);
    // Canal de entrega de dev (Resend chega na Fase 1.6). O token bruto NÃO
    // vai para EventLog/AuditLog/banco — apenas para este console e a URL.
    console.log(`[admin-magic-link] ${admin.email} -> ${redeemUrl}`);
  }

  // Auditoria — registrada para email conhecido E desconhecido (adminUserId
  // nullable). O payload nunca inclui o token.
  await logAdminAction({
    adminUserId: admin?.id ?? null,
    action: "ADMIN_LOGIN_REQUESTED",
    entityType: "AdminUser",
    entityId: admin?.id ?? "unknown",
    after: { email, adminFound: admin !== null, adminActive: admin?.active ?? false },
    ipAddress: ip,
    userAgent,
  });

  // Resposta de tempo constante — não vaza, pelo timing, se o email existe.
  await padConstantTime(startedAt);
  return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
}
