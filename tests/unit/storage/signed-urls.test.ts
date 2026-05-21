import { describe, expect, it } from "vitest";
import {
  StorageObjectNotFoundError,
  checkObjectExists,
  createSignedUrl,
  getStorageBucket,
} from "@/lib/storage/signed-urls";

/**
 * Testes da camada de Storage — fazem chamadas HTTP REAIS ao Supabase Storage
 * (bucket `tenant-content`, objeto seedado `missa-explicada/ebook.pdf`).
 *
 * Latência sa-east-1 pode causar flakiness; o `testTimeout` global do vitest
 * (30s) cobre. Se começarem a falhar por rede, marcar `.skip` e investigar
 * depois — não bloqueia desenvolvimento (combinado na aprovação da Fase 1.5).
 */
const BUCKET = getStorageBucket();
const SEEDED_PDF = "missa-explicada/ebook.pdf";

describe("getStorageBucket", () => {
  it("lê STORAGE_BUCKET do ambiente (default tenant-content)", () => {
    expect(BUCKET).toBe(process.env.STORAGE_BUCKET ?? "tenant-content");
  });
});

describe("createSignedUrl", () => {
  it("gera uma signed URL válida para um objeto existente", async () => {
    const before = Date.now();
    const signed = await createSignedUrl(BUCKET, SEEDED_PDF, 900);

    expect(signed.url).toContain("/object/sign/");
    expect(signed.url).toContain("token=");
    // expiresAt ~ now + 900s.
    expect(signed.expiresAt.getTime()).toBeGreaterThan(before + 890_000);
    expect(signed.expiresAt.getTime()).toBeLessThan(before + 910_000);
  });

  it("usa 900s (15 min) como expiração padrão", async () => {
    const before = Date.now();
    const signed = await createSignedUrl(BUCKET, SEEDED_PDF);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(before + 890_000);
  });

  it("lança StorageObjectNotFoundError para um objeto inexistente", async () => {
    await expect(
      createSignedUrl(BUCKET, "missa-explicada/nao-existe-xyz.pdf"),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});

describe("checkObjectExists", () => {
  it("retorna true para um objeto existente", async () => {
    expect(await checkObjectExists(BUCKET, SEEDED_PDF)).toBe(true);
  });

  it("retorna false para um objeto inexistente", async () => {
    expect(await checkObjectExists(BUCKET, "missa-explicada/nao-existe-xyz.pdf")).toBe(false);
  });
});
