import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Magic link do ADMIN — `AdminMagicLink`.
 *
 * Tabela separada do `AccessToken` do cliente (lógicas independentes).
 * Segurança (regras duras da Sub-fase 5.0):
 *  - o token BRUTO só existe na URL enviada; no banco grava-se apenas o
 *    hash SHA-256 (`tokenHash`);
 *  - expira em 15 min; uso único (marca `usedAt`).
 *
 * O envio real (Resend) chega na Fase 1.6 — na 5.0 o link é logado no console.
 */
const ADMIN_MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export class AdminMagicLinkNotFoundError extends Error {
  constructor() {
    super("Magic link admin não encontrado.");
    this.name = "AdminMagicLinkNotFoundError";
  }
}

export class AdminMagicLinkExpiredError extends Error {
  readonly adminUserId: string;
  constructor(adminUserId: string) {
    super("Magic link admin expirado.");
    this.name = "AdminMagicLinkExpiredError";
    this.adminUserId = adminUserId;
  }
}

export class AdminMagicLinkUsedError extends Error {
  readonly adminUserId: string;
  constructor(adminUserId: string) {
    super("Magic link admin já utilizado.");
    this.name = "AdminMagicLinkUsedError";
    this.adminUserId = adminUserId;
  }
}

/** SHA-256 do token — o que vai para o banco. Nunca o token bruto. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreatedAdminMagicLink {
  token: string; // bruto — só vai na URL
  expiresAt: Date;
}

/** Gera um magic link para o admin: cria o registro (com hash) e devolve o token bruto. */
export async function createAdminMagicLink(adminUserId: string): Promise<CreatedAdminMagicLink> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ADMIN_MAGIC_LINK_TTL_MS);
  await prisma.adminMagicLink.create({
    data: { adminUserId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Consome um magic link: valida (existe? não expirado? não usado?) e queima
 * (`usedAt`) atomicamente. Devolve o `adminUserId`.
 *
 * Os erros de expirado/usado carregam o `adminUserId` — o caller usa para
 * auditar `ADMIN_LOGIN_FAILED` mesmo numa tentativa que falhou.
 */
export async function validateAdminMagicLink(token: string): Promise<{ adminUserId: string }> {
  const record = await prisma.adminMagicLink.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!record) {
    throw new AdminMagicLinkNotFoundError();
  }
  if (record.usedAt) {
    throw new AdminMagicLinkUsedError(record.adminUserId);
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new AdminMagicLinkExpiredError(record.adminUserId);
  }

  // Queima atômica via updateMany condicional — protege contra uso duplo em corrida.
  const burned = await prisma.adminMagicLink.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count === 0) {
    throw new AdminMagicLinkUsedError(record.adminUserId);
  }

  return { adminUserId: record.adminUserId };
}

/** Monta a URL de resgate do admin (`/admin/auth/redeem?t=<token>`). */
export function buildAdminRedeemUrl(token: string, baseUrl: string): string {
  const url = new URL("/admin/auth/redeem", baseUrl);
  url.searchParams.set("t", token);
  return url.toString();
}
