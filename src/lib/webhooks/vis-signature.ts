import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validação da assinatura HMAC-V1 dos webhooks da VIS.
 * Ver WEBHOOK_CONTRACT.md seção 5.
 *
 * Header: `X-Webhook-Signature-V1: t=<unix-ts>,v1=<hmac-sha256-de-(ts.body)>`
 */
const MAX_AGE_SEC = 300; // 5 min — anti-replay
const MAX_FUTURE_SEC = 30; // tolerância de relógio adiantado

export type SignatureFailureReason = "malformed" | "too_old" | "too_future" | "mismatch";

export type SignatureCheck = { valid: true } | { valid: false; reason: SignatureFailureReason };

/**
 * Valida o header `X-Webhook-Signature-V1` contra o raw body e o secret.
 * A comparação do hash é timing-safe (`crypto.timingSafeEqual`).
 */
export function verifyWebhookV1(
  header: string | null | undefined,
  rawBody: string,
  secret: string,
  maxAgeSec: number = MAX_AGE_SEC,
): SignatureCheck {
  if (!header) {
    return { valid: false, reason: "malformed" };
  }

  // Parse de "t=<ts>,v1=<hash>".
  const parts = new Map<string, string>();
  for (const segment of header.split(",")) {
    const idx = segment.indexOf("=");
    if (idx === -1) continue;
    parts.set(segment.slice(0, idx).trim(), segment.slice(idx + 1).trim());
  }

  const tsRaw = parts.get("t");
  const v1 = parts.get("v1");
  if (!tsRaw || !v1) {
    return { valid: false, reason: "malformed" };
  }

  const ts = Number.parseInt(tsRaw, 10);
  if (!Number.isFinite(ts) || String(ts) !== tsRaw) {
    return { valid: false, reason: "malformed" };
  }
  // v1 precisa ser hex de comprimento par para virar Buffer.
  if (!/^[0-9a-f]+$/i.test(v1) || v1.length % 2 !== 0) {
    return { valid: false, reason: "malformed" };
  }

  // Anti-replay: rejeita timestamps muito antigos ou muito no futuro.
  const ageSec = Math.floor(Date.now() / 1000) - ts;
  if (ageSec > maxAgeSec) {
    return { valid: false, reason: "too_old" };
  }
  if (ageSec < -MAX_FUTURE_SEC) {
    return { valid: false, reason: "too_future" };
  }

  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");

  const providedBuf = Buffer.from(v1, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  // timingSafeEqual lança se os tamanhos diferem — confere antes.
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: "mismatch" };
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}

/**
 * Validação do header legado `X-Webhook-Signature` (HMAC simples, sem timestamp).
 * Implementado apenas para auditoria — a Plataforma de Membros REJEITA webhooks
 * que não tragam o V1. Não usar como fallback de autenticação.
 */
export function verifyWebhookLegacy(
  header: string | null | undefined,
  rawBody: string,
  secret: string,
): { valid: boolean } {
  if (!header || !/^[0-9a-f]+$/i.test(header) || header.length % 2 !== 0) {
    return { valid: false };
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const providedBuf = Buffer.from(header, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false };
  }
  return { valid: timingSafeEqual(providedBuf, expectedBuf) };
}
