import { randomUUID } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * AccessToken — token single-use de 15 min para login automático pós-checkout
 * e "esqueci o acesso". Ver ARCHITECTURE.md seção 6.
 */
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

export class TokenNotFoundError extends Error {
  constructor() {
    super("AccessToken não encontrado.");
    this.name = "TokenNotFoundError";
  }
}

export class TokenExpiredError extends Error {
  constructor() {
    super("AccessToken expirado.");
    this.name = "TokenExpiredError";
  }
}

export class TokenAlreadyUsedError extends Error {
  constructor() {
    super("AccessToken já utilizado.");
    this.name = "TokenAlreadyUsedError";
  }
}

/**
 * Gera um AccessToken para o usuário e persiste o registro.
 * Retorna apenas o token (string) — a URL é montada com `buildRedeemUrl`.
 *
 * `client` aceita um client de transação (uso em testes / provisionamento atômico).
 */
export async function generateAccessToken(
  userId: string,
  orderId?: string,
  client: Prisma.TransactionClient = prisma,
): Promise<string> {
  const token = randomUUID();
  await client.accessToken.create({
    data: {
      userId,
      orderId: orderId ?? null,
      token,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    },
  });
  return token;
}

/**
 * Consome um AccessToken: valida (existe? não expirado? não usado?), queima
 * (marca `usedAt`) e retorna o User. A queima é atômica via `updateMany`
 * condicional — protege contra uso duplo em corrida.
 */
export async function redeemAccessToken(
  token: string,
  client: Prisma.TransactionClient = prisma,
): Promise<User> {
  const record = await client.accessToken.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!record) {
    throw new TokenNotFoundError();
  }
  if (record.usedAt) {
    throw new TokenAlreadyUsedError();
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new TokenExpiredError();
  }

  const burned = await client.accessToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count === 0) {
    // Outra request queimou o token entre o findUnique e o updateMany.
    throw new TokenAlreadyUsedError();
  }

  return record.user;
}

/** Monta a URL de resgate (`/auth/redeem?t=<token>`) a partir de uma base. */
export function buildRedeemUrl(token: string, baseUrl: string): string {
  const url = new URL("/auth/redeem", baseUrl);
  url.searchParams.set("t", token);
  return url.toString();
}
