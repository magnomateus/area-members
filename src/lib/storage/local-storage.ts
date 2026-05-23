import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

/**
 * Storage local em filesystem (substituto do Supabase Storage — Fase 2 da
 * migração Vercel/Supabase → Titan/MySQL). Ver docs/DECISIONS/004.
 *
 * Layout: `STORAGE_PATH/<tenant-slug>/<uniqueId>-<sanitizedName>.<ext>`. Em dev,
 * `STORAGE_PATH=./storage/files`; em prod, `/var/data/vis-membros/files`.
 *
 * Segurança:
 *  - Whitelist de MIME types + checagem de extensão.
 *  - Limite de tamanho por categoria (PDF 50MB / áudio 100MB / vídeo 500MB).
 *  - Sanitização do nome (sem path traversal, sem caracteres especiais).
 *  - `resolveFileKey` valida que o caminho final está DENTRO de `STORAGE_PATH`.
 */

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export class StorageObjectNotFoundError extends StorageError {
  readonly fileKey: string;
  constructor(fileKey: string) {
    super(`Objeto não encontrado no storage: ${fileKey}`);
    this.name = "StorageObjectNotFoundError";
    this.fileKey = fileKey;
  }
}

export class StorageValidationError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = "StorageValidationError";
  }
}

const DEFAULT_STORAGE_PATH = "./storage/files";

export function getStoragePath(): string {
  return process.env.STORAGE_PATH ?? DEFAULT_STORAGE_PATH;
}

type Category = "PDF" | "AUDIO" | "VIDEO";
interface AllowedSpec {
  extensions: string[];
  maxBytes: number;
  category: Category;
}

const ALLOWED: Record<string, AllowedSpec> = {
  "application/pdf": { extensions: [".pdf"], maxBytes: 50 * 1024 * 1024, category: "PDF" },
  "audio/mpeg": { extensions: [".mp3"], maxBytes: 100 * 1024 * 1024, category: "AUDIO" },
  "audio/ogg": { extensions: [".ogg", ".oga"], maxBytes: 100 * 1024 * 1024, category: "AUDIO" },
  "video/mp4": { extensions: [".mp4"], maxBytes: 500 * 1024 * 1024, category: "VIDEO" },
  "video/quicktime": { extensions: [".mov"], maxBytes: 500 * 1024 * 1024, category: "VIDEO" },
};

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

/** Content-Type a partir da extensão do fileKey (fallback octet-stream). */
export function inferContentTypeFromKey(fileKey: string): string {
  const ext = path.extname(fileKey).toLowerCase();
  return EXT_TO_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

/**
 * Sanitiza um nome de arquivo: remove diacríticos, lowercase, troca
 * não-alfanuméricos por `_`, ignora qualquer prefixo de pasta no input.
 * Trata `stem` e `ext` separadamente para que o trim de underscores
 * funcione mesmo quando há extensão (ex.: `___a_.pdf` → `a.pdf`).
 */
export function sanitizeFilename(name: string): string {
  const stripDiacritics = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const base = path.basename(stripDiacritics);
  const ext = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length);
  const cleanedStem = stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  const finalStem = cleanedStem.length > 0 ? cleanedStem : "file";
  return ext.length > 0 ? `${finalStem}${ext}` : finalStem;
}

/**
 * Resolve `fileKey` (relativo) para caminho absoluto, validando que o
 * resultado está DENTRO de `STORAGE_PATH`. Protege contra path traversal.
 */
function resolveFileKey(fileKey: string): string {
  const base = path.resolve(getStoragePath());
  const full = path.resolve(base, fileKey);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new StorageValidationError(`fileKey fora do storage base: ${fileKey}`);
  }
  return full;
}

export interface SaveFileResult {
  fileKey: string;
  sizeBytes: number;
}

/**
 * Grava `buffer` no filesystem dentro de `<tenantSlug>/`. Valida MIME,
 * extensão e tamanho. Retorna o `fileKey` (caminho relativo) e o tamanho.
 */
export async function saveFile(opts: {
  buffer: Buffer;
  originalName: string;
  contentType: string;
  tenantSlug: string;
}): Promise<SaveFileResult> {
  const { buffer, originalName, contentType, tenantSlug } = opts;

  const spec = ALLOWED[contentType];
  if (!spec) {
    throw new StorageValidationError(`Tipo MIME não suportado: ${contentType}.`);
  }
  if (buffer.byteLength > spec.maxBytes) {
    throw new StorageValidationError(
      `Arquivo excede limite (${String(spec.maxBytes)} bytes para ${spec.category}).`,
    );
  }

  const sanitized = sanitizeFilename(originalName);
  const ext = path.extname(sanitized).toLowerCase();
  if (!spec.extensions.includes(ext)) {
    throw new StorageValidationError(`Extensão ${ext} não bate com MIME ${contentType}.`);
  }

  const tenantSafe = tenantSlug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (tenantSafe.length === 0) {
    throw new StorageValidationError("tenantSlug inválido.");
  }
  const uniqueId = randomBytes(8).toString("hex");
  const fileKey = `${tenantSafe}/${uniqueId}-${sanitized}`;
  const fullPath = resolveFileKey(fileKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
  return { fileKey, sizeBytes: buffer.byteLength };
}

/** Retorna `true` se o objeto existe e é um arquivo. */
export async function fileExists(fileKey: string): Promise<boolean> {
  try {
    const full = resolveFileKey(fileKey);
    const info = await stat(full);
    return info.isFile();
  } catch {
    return false;
  }
}

export interface ReadFileResult {
  stream: Readable;
  sizeBytes: number;
  contentType: string;
}

/**
 * Abre uma ReadStream do arquivo. Lança `StorageObjectNotFoundError` se o
 * arquivo não existe; `StorageValidationError` se o fileKey é inválido
 * (path traversal).
 */
export async function readFile(fileKey: string): Promise<ReadFileResult> {
  const full = resolveFileKey(fileKey);
  let info;
  try {
    info = await stat(full);
  } catch {
    throw new StorageObjectNotFoundError(fileKey);
  }
  if (!info.isFile()) {
    throw new StorageObjectNotFoundError(fileKey);
  }
  return {
    stream: createReadStream(full),
    sizeBytes: info.size,
    contentType: inferContentTypeFromKey(fileKey),
  };
}

/** Remove o arquivo. Lança `StorageObjectNotFoundError` se não existe. */
export async function deleteFile(fileKey: string): Promise<void> {
  const full = resolveFileKey(fileKey);
  try {
    await unlink(full);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new StorageObjectNotFoundError(fileKey);
    }
    throw error;
  }
}
