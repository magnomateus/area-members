import { randomUUID } from "node:crypto";
import { readFile as fsReadFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  StorageObjectNotFoundError,
  StorageValidationError,
  deleteFile,
  fileExists,
  getStoragePath,
  inferContentTypeFromKey,
  readFile,
  sanitizeFilename,
  saveFile,
} from "@/lib/storage/local-storage";

/**
 * Testes do storage local. Usam o `STORAGE_PATH` real do `.env` e isolam
 * todos os fixtures sob um slug de tenant exclusivo por run, removido no
 * final.
 */
const TEST_TENANT = `__test-${randomUUID().slice(0, 8)}`;
const STORAGE_BASE = path.resolve(getStoragePath());

function pdfBuffer(): Buffer {
  // Cabeçalho mínimo válido de PDF — basta pro storage tratar como bytes.
  return Buffer.from("%PDF-1.4\n%dummy\n", "utf8");
}

afterAll(async () => {
  await rm(path.join(STORAGE_BASE, TEST_TENANT), { recursive: true, force: true });
});

describe("sanitizeFilename", () => {
  it("normaliza diacríticos, lowercase e troca especiais por _", () => {
    expect(sanitizeFilename("Café com Pão.pdf")).toBe("cafe_com_pao.pdf");
  });

  it("descarta componentes de path (impede traversal no nome)", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("foo/bar/baz.mp3")).toBe("baz.mp3");
  });

  it("colapsa underscores e remove leading/trailing", () => {
    expect(sanitizeFilename("___A   B___.pdf")).toBe("a_b.pdf");
  });

  it("fallback 'file' para entrada vazia/só especiais", () => {
    expect(sanitizeFilename("@@@")).toBe("file");
  });
});

describe("inferContentTypeFromKey", () => {
  it("mapeia extensões conhecidas", () => {
    expect(inferContentTypeFromKey("foo.pdf")).toBe("application/pdf");
    expect(inferContentTypeFromKey("a/b/c.MP3")).toBe("audio/mpeg");
    expect(inferContentTypeFromKey("video.mov")).toBe("video/quicktime");
  });

  it("fallback octet-stream para desconhecidas", () => {
    expect(inferContentTypeFromKey("foo.bin")).toBe("application/octet-stream");
  });
});

describe("saveFile / fileExists / readFile / deleteFile", () => {
  it("grava PDF válido, retorna fileKey e size; readFile devolve stream + size + content-type", async () => {
    const result = await saveFile({
      buffer: pdfBuffer(),
      originalName: "Ebook Teste.pdf",
      contentType: "application/pdf",
      tenantSlug: TEST_TENANT,
    });
    expect(result.fileKey).toMatch(new RegExp(`^${TEST_TENANT}/[a-f0-9]{16}-ebook_teste\\.pdf$`));
    expect(result.sizeBytes).toBe(pdfBuffer().byteLength);
    expect(await fileExists(result.fileKey)).toBe(true);

    const read = await readFile(result.fileKey);
    expect(read.sizeBytes).toBe(result.sizeBytes);
    expect(read.contentType).toBe("application/pdf");
    // Drena o stream para fechar o handle do filesystem antes de deletar.
    // `createReadStream` abre o fd assincronamente; um `destroy()` cru antes
    // do open completar gera um ENOENT tardio.
    for await (const _chunk of read.stream) {
      // só drena
    }

    await deleteFile(result.fileKey);
    expect(await fileExists(result.fileKey)).toBe(false);
  });

  it("rejeita MIME não permitido", async () => {
    await expect(
      saveFile({
        buffer: Buffer.from("x"),
        originalName: "a.exe",
        contentType: "application/octet-stream",
        tenantSlug: TEST_TENANT,
      }),
    ).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("rejeita extensão que não bate com o MIME", async () => {
    await expect(
      saveFile({
        buffer: pdfBuffer(),
        originalName: "fake.mp3",
        contentType: "application/pdf",
        tenantSlug: TEST_TENANT,
      }),
    ).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("rejeita arquivo acima do limite da categoria", async () => {
    const big = Buffer.alloc(51 * 1024 * 1024); // PDF: 50MB max
    await expect(
      saveFile({
        buffer: big,
        originalName: "big.pdf",
        contentType: "application/pdf",
        tenantSlug: TEST_TENANT,
      }),
    ).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("readFile lança StorageObjectNotFoundError para arquivo ausente", async () => {
    await expect(readFile(`${TEST_TENANT}/nao-existe-xyz.pdf`)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it("readFile com fileKey de traversal lança StorageValidationError", async () => {
    await expect(readFile("../../etc/passwd")).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("conteúdo gravado bate byte-a-byte com o buffer original", async () => {
    const original = Buffer.from("%PDF-1.7\nABCDEFG\n", "utf8");
    const saved = await saveFile({
      buffer: original,
      originalName: "roundtrip.pdf",
      contentType: "application/pdf",
      tenantSlug: TEST_TENANT,
    });
    const onDisk = await fsReadFile(path.join(STORAGE_BASE, saved.fileKey));
    expect(onDisk.equals(original)).toBe(true);
  });
});

describe("deleteFile", () => {
  it("lança StorageObjectNotFoundError ao tentar deletar inexistente", async () => {
    await expect(deleteFile(`${TEST_TENANT}/nao-existe.pdf`)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });
});
