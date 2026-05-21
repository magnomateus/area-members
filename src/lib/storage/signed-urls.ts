import { getSupabaseStorageClient } from "./supabase-client";

/**
 * Signed URLs do Supabase Storage.
 *
 * Uma signed URL é um link temporário e assinado para um objeto de um bucket
 * PRIVADO. Expira em `expirySec` segundos — proteção contra compartilhamento
 * do link (ver ARCHITECTURE.md seção sobre entrega de conteúdo).
 */

/** Expiração padrão de uma signed URL: 15 minutos. */
export const DEFAULT_SIGNED_URL_EXPIRY_SEC = 900;

/** Erro genérico de Storage (falha de rede, permissão, etc). */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * O objeto referenciado não existe no bucket. Situação crítica: significa que
 * o `fileKey` do banco aponta para um arquivo que sumiu (ou nunca subiu).
 */
export class StorageObjectNotFoundError extends StorageError {
  readonly path: string;
  constructor(path: string) {
    super(`Objeto não encontrado no Storage: ${path}`);
    this.name = "StorageObjectNotFoundError";
    this.path = path;
  }
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

/** Bucket de conteúdo dos tenants. Lê de env, com default `tenant-content`. */
export function getStorageBucket(): string {
  return process.env.STORAGE_BUCKET ?? "tenant-content";
}

/**
 * Gera uma signed URL para `path` dentro de `bucket`, válida por `expirySec`.
 *
 * Lança `StorageObjectNotFoundError` se o objeto não existe e `StorageError`
 * para qualquer outra falha.
 */
export async function createSignedUrl(
  bucket: string,
  path: string,
  expirySec: number = DEFAULT_SIGNED_URL_EXPIRY_SEC,
): Promise<SignedUrl> {
  const client = getSupabaseStorageClient();
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expirySec);

  if (error || !data) {
    const message = error?.message ?? "resposta vazia do Storage";
    if (/not.?found/i.test(message)) {
      throw new StorageObjectNotFoundError(path);
    }
    throw new StorageError(`Falha ao gerar signed URL para "${path}": ${message}`);
  }

  return {
    url: data.signedUrl,
    // O Supabase não devolve o instante de expiração; derivamos de `expirySec`.
    expiresAt: new Date(Date.now() + expirySec * 1000),
  };
}

/**
 * Verifica se um objeto existe no bucket. Usa `list` na pasta-pai filtrando
 * pelo nome do arquivo — o Storage não tem um `exists()` direto.
 */
export async function checkObjectExists(bucket: string, path: string): Promise<boolean> {
  const client = getSupabaseStorageClient();
  const lastSlash = path.lastIndexOf("/");
  const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

  const { data, error } = await client.storage
    .from(bucket)
    .list(folder, { search: filename, limit: 100 });

  if (error) {
    throw new StorageError(`Falha ao verificar objeto "${path}": ${error.message}`);
  }
  return (data ?? []).some((entry) => entry.name === filename);
}
