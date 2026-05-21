import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasAccessToContentItem } from "@/lib/entitlements/check";
import {
  DEFAULT_SIGNED_URL_EXPIRY_SEC,
  StorageObjectNotFoundError,
  createSignedUrl,
  getStorageBucket,
} from "./signed-urls";

/**
 * Core de "gerar signed URL para um ContentItem".
 *
 * Função pura de domínio, testável fora do runtime do Next: recebe `userId`,
 * `tenantId` e `contentItemId` já resolvidos e devolve a URL assinada. A rota
 * `GET /api/content/[id]/signed-url` é só uma casca fina sobre isto (padrão
 * core + rota fina da sub-fase 1.3b).
 *
 * Fluxo: rate limit → resolve+autoriza o ContentItem → valida o tipo → gera a
 * signed URL (15 min) → marca Progress → registra EventLog forense.
 */

type DbClient = Prisma.TransactionClient | typeof prisma;

/** ContentItem não existe (ou existe em outro tenant — não se vaza a diferença). */
export class ContentNotFoundError extends Error {
  constructor() {
    super("ContentItem não encontrado.");
    this.name = "ContentNotFoundError";
  }
}

/** Usuário logado, mas sem Entitlement ativo para o Product do ContentItem. */
export class ContentAccessDeniedError extends Error {
  constructor() {
    super("Usuário não tem acesso a este conteúdo.");
    this.name = "ContentAccessDeniedError";
  }
}

/** O tipo do ContentItem não é um arquivo entregável via signed URL. */
export class InvalidContentTypeError extends Error {
  constructor() {
    super("Este conteúdo não é um arquivo para download.");
    this.name = "InvalidContentTypeError";
  }
}

/** O usuário estourou o limite de solicitações de signed URL. */
export class RateLimitError extends Error {
  constructor() {
    super("Muitas solicitações de download. Aguarde um minuto.");
    this.name = "RateLimitError";
  }
}

export interface GetContentSignedUrlResult {
  url: string;
  expiresAt: Date;
  title: string;
}

// ── Rate limit: 10 solicitações por minuto por usuário ──────────────────────
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const userHits = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (userHits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    userHits.set(userId, recent);
    return true;
  }
  recent.push(now);
  userHits.set(userId, recent);
  return false;
}

export interface GetContentSignedUrlArgs {
  userId: string;
  tenantId: string;
  contentItemId: string;
  client?: DbClient;
}

export async function getContentSignedUrl(
  args: GetContentSignedUrlArgs,
): Promise<GetContentSignedUrlResult> {
  const { userId, tenantId, contentItemId } = args;
  const client = args.client ?? prisma;

  if (isRateLimited(userId)) {
    throw new RateLimitError();
  }

  const { contentItem, product, hasAccess } = await hasAccessToContentItem(
    userId,
    contentItemId,
    tenantId,
    client,
  );

  if (!contentItem) {
    throw new ContentNotFoundError();
  }
  if (!hasAccess) {
    throw new ContentAccessDeniedError();
  }

  // Só itens com arquivo no Storage têm signed URL — PDF/AUDIO_FILE/VIDEO_FILE.
  // EXTERNAL_LINK, VIDEO_EMBED e TEXT não têm `fileKey`.
  if (!contentItem.fileKey) {
    throw new InvalidContentTypeError();
  }

  const bucket = getStorageBucket();
  let signed;
  try {
    signed = await createSignedUrl(bucket, contentItem.fileKey, DEFAULT_SIGNED_URL_EXPIRY_SEC);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      // O `fileKey` aponta para um arquivo que sumiu do bucket — situação
      // crítica de dados. Registra com level=error para alerta interno.
      await client.eventLog.create({
        data: {
          tenantId,
          type: "content.file_missing",
          level: "error",
          message: `fileKey "${contentItem.fileKey}" não existe no bucket "${bucket}".`,
          payload: { contentItemId, fileKey: contentItem.fileKey, bucket },
          userId,
        },
      });
    }
    throw error;
  }

  // Marca consumo do conteúdo. upsert pela @@unique([userId, contentItemId]).
  await client.progress.upsert({
    where: { userId_contentItemId: { userId, contentItemId } },
    update: { lastAccessedAt: new Date() },
    create: { userId, contentItemId, status: "IN_PROGRESS" },
  });

  // EventLog forense. NUNCA registra a signed URL (link temporário sensível).
  await client.eventLog.create({
    data: {
      tenantId,
      type: "content.accessed",
      level: "info",
      message: `ContentItem "${contentItem.title}" acessado — signed URL gerada.`,
      payload: { contentItemId, productId: product?.id ?? null },
      userId,
    },
  });

  return { url: signed.url, expiresAt: signed.expiresAt, title: contentItem.title };
}
