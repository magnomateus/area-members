import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed URLs com HMAC-SHA256 nativo (substituto das signed URLs do Supabase —
 * Fase 2 da migração). Ver docs/DECISIONS/004.
 *
 * Token = `<payload_base64url>.<hmac_base64url>` onde
 * `payload = JSON.stringify({ fileKey, expiresAt })`. Comparação do HMAC é
 * timing-safe (`crypto.timingSafeEqual`). Token único = uma falha → 404 no
 * route handler (anti-enumeração).
 */
export const DEFAULT_SIGNED_URL_EXPIRY_SEC = 900; // 15 min

export class SignedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignedUrlError";
  }
}

function getSecret(): Buffer {
  const secret = process.env.STORAGE_SIGN_SECRET;
  if (!secret || secret.length < 32) {
    throw new SignedUrlError("STORAGE_SIGN_SECRET ausente ou muito curto (mínimo 32 chars).");
  }
  return Buffer.from(secret, "utf8");
}

interface SignedPayload {
  fileKey: string;
  expiresAt: number; // epoch ms
}

export interface CreatedSignedUrl {
  url: string;
  token: string;
  expiresAt: Date;
}

/** Gera um token assinado para `fileKey` válido por `ttlSec` segundos. */
export function createSignedUrl(
  fileKey: string,
  ttlSec: number = DEFAULT_SIGNED_URL_EXPIRY_SEC,
): CreatedSignedUrl {
  const expiresAtMs = Date.now() + ttlSec * 1000;
  const payload: SignedPayload = { fileKey, expiresAt: expiresAtMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  const token = `${payloadB64}.${sig.toString("base64url")}`;
  return {
    url: `/api/files/${token}`,
    token,
    expiresAt: new Date(expiresAtMs),
  };
}

export type ValidateResult =
  | { valid: true; fileKey: string }
  | { valid: false; reason: "invalid" | "expired" };

/**
 * Valida um token: confere o HMAC (timing-safe) e a expiração. Devolve sempre
 * um resultado discriminado — o caller não precisa de try/catch.
 */
export function validateSignedUrl(token: string): ValidateResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "invalid" };
  }
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) {
    return { valid: false, reason: "invalid" };
  }

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return { valid: false, reason: "invalid" };
  }
  const expectedSig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  if (providedSig.length !== expectedSig.length) {
    return { valid: false, reason: "invalid" };
  }
  if (!timingSafeEqual(providedSig, expectedSig)) {
    return { valid: false, reason: "invalid" };
  }

  let payload: SignedPayload;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).fileKey !== "string" ||
      typeof (parsed as Record<string, unknown>).expiresAt !== "number"
    ) {
      return { valid: false, reason: "invalid" };
    }
    payload = parsed as SignedPayload;
  } catch {
    return { valid: false, reason: "invalid" };
  }

  if (payload.expiresAt < Date.now()) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, fileKey: payload.fileKey };
}
