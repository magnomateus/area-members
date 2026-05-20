import { prisma } from "@/lib/db";
import { buildRedeemUrl, generateAccessToken } from "@/lib/auth/tokens";
import { getCurrentTenantId } from "@/lib/tenant/context";

/**
 * Fluxo de magic link.
 *
 * Lógica única compartilhada pelo endpoint `POST /api/auth/magic-link` e pela
 * Server Action da página `/login`.
 *
 * Princípios (ARCHITECTURE.md seção 10):
 *  - Anti-enumeração: nunca confirma/nega a existência de um email — sempre
 *    retorna `ok` e o tempo de resposta é constante (~200ms).
 *  - Rate limit: 3 requests / 15 min / IP (Map em memória).
 *
 * Limitação conhecida: o rate limit em memória é por processo. Em produção
 * multi-instância (Vercel) precisará de um store compartilhado (Redis/Upstash).
 */
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const CONSTANT_RESPONSE_MS = 200;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function padConstantTime(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < CONSTANT_RESPONSE_MS) {
    await sleep(CONSTANT_RESPONSE_MS - elapsed);
  }
}

export type MagicLinkResult = { status: "ok" | "rate_limited" };

export async function requestMagicLink(params: {
  email: string;
  ip: string;
  baseUrl: string;
}): Promise<MagicLinkResult> {
  const { email, ip, baseUrl } = params;

  if (isRateLimited(ip)) {
    return { status: "rate_limited" };
  }

  const startedAt = Date.now();
  const normalizedEmail = email.trim().toLowerCase();
  const tenantId = await getCurrentTenantId();

  // Sem tenant não há como localizar o usuário. Trata como email desconhecido
  // (não vaza informação) e registra para diagnóstico.
  const user = tenantId
    ? await prisma.user.findUnique({
        where: { tenantId_email: { tenantId, email: normalizedEmail } },
      })
    : null;

  if (!user) {
    await prisma.eventLog.create({
      data: {
        tenantId,
        type: "magic_link.requested_unknown_email",
        level: "warn",
        message: "Magic link solicitado para email não cadastrado.",
        payload: { email: normalizedEmail },
      },
    });
    await padConstantTime(startedAt);
    return { status: "ok" };
  }

  const token = await generateAccessToken(user.id);
  const redeemUrl = buildRedeemUrl(token, baseUrl);

  // Envio real por WhatsApp/email vem na sub-fase 1.6. Por ora, só console.
  console.log(`[magic-link] ${user.email} -> ${redeemUrl}`);

  await prisma.eventLog.create({
    data: {
      tenantId,
      userId: user.id,
      type: "magic_link.requested",
      level: "info",
      message: "Magic link gerado.",
      payload: { email: user.email },
    },
  });

  await padConstantTime(startedAt);
  return { status: "ok" };
}
