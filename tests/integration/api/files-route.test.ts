import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/files/[token]/route";
import { deleteFile, getStoragePath, saveFile } from "@/lib/storage/local-storage";
import { createSignedUrl } from "@/lib/storage/signed-urls-hmac";

/**
 * Testes do route handler `GET /api/files/[token]`.
 *
 * Cria arquivos reais no filesystem (em `<STORAGE_PATH>/<test-slug>/`) e
 * limpa no afterAll. Garante a propriedade central: **toda falha responde
 * 404** com o mesmo corpo (anti-enumeração).
 */
const TEST_TENANT = `__test-files-${randomUUID().slice(0, 8)}`;
const STORAGE_BASE = path.resolve(getStoragePath());

afterAll(async () => {
  await rm(path.join(STORAGE_BASE, TEST_TENANT), { recursive: true, force: true });
});

function buildRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/files/x");
}

function paramsOf(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) };
}

describe("GET /api/files/[token]", () => {
  it("token válido + arquivo presente → 200 com content-type correto", async () => {
    const buffer = Buffer.from("%PDF-1.4\nhello\n", "utf8");
    const { fileKey } = await saveFile({
      buffer,
      originalName: "hello.pdf",
      contentType: "application/pdf",
      tenantSlug: TEST_TENANT,
    });
    const { token } = createSignedUrl(fileKey);

    const res = await GET(buildRequest(), paramsOf(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe(String(buffer.byteLength));
    expect(res.headers.get("content-disposition")).toBe("inline");

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(buffer)).toBe(true);
  });

  it("token válido mas arquivo sumiu → 404", async () => {
    const { fileKey } = await saveFile({
      buffer: Buffer.from("%PDF-1.4\n"),
      originalName: "sumido.pdf",
      contentType: "application/pdf",
      tenantSlug: TEST_TENANT,
    });
    const { token } = createSignedUrl(fileKey);
    await deleteFile(fileKey);

    const res = await GET(buildRequest(), paramsOf(token));
    expect(res.status).toBe(404);
  });

  it("token malformado → 404 (sem ponto)", async () => {
    const res = await GET(buildRequest(), paramsOf("nao-eh-um-token"));
    expect(res.status).toBe(404);
  });

  it("token com HMAC adulterado → 404", async () => {
    const { fileKey } = await saveFile({
      buffer: Buffer.from("%PDF-1.4\n"),
      originalName: "tampered.pdf",
      contentType: "application/pdf",
      tenantSlug: TEST_TENANT,
    });
    const { token } = createSignedUrl(fileKey);
    const [payload, sig] = token.split(".");
    const tampered = `${payload}.${sig.replace(/^./, sig[0] === "A" ? "B" : "A")}`;

    const res = await GET(buildRequest(), paramsOf(tampered));
    expect(res.status).toBe(404);
  });

  it("token expirado → 404 (não distinguível de inválido)", async () => {
    const { fileKey } = await saveFile({
      buffer: Buffer.from("%PDF-1.4\n"),
      originalName: "expirado.pdf",
      contentType: "application/pdf",
      tenantSlug: TEST_TENANT,
    });
    const { token } = createSignedUrl(fileKey, -1);

    const res = await GET(buildRequest(), paramsOf(token));
    expect(res.status).toBe(404);
  });
});
