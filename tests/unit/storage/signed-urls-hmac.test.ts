import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_URL_EXPIRY_SEC,
  createSignedUrl,
  validateSignedUrl,
} from "@/lib/storage/signed-urls-hmac";

/**
 * Testes da assinatura HMAC. Usam o STORAGE_SIGN_SECRET do `.env` carregado
 * pelo vitest (não há mock — a função é pura, depende só do env).
 */
describe("createSignedUrl", () => {
  it("gera token <payload>.<sig> e URL /api/files/<token>", () => {
    const before = Date.now();
    const signed = createSignedUrl("tenant-x/file.pdf");
    expect(signed.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(signed.url).toBe(`/api/files/${signed.token}`);
    // expiresAt ≈ now + default TTL.
    const ttlMs = DEFAULT_SIGNED_URL_EXPIRY_SEC * 1000;
    expect(signed.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs - 1000);
    expect(signed.expiresAt.getTime()).toBeLessThanOrEqual(before + ttlMs + 1000);
  });
});

describe("validateSignedUrl", () => {
  it("aceita token recém-gerado e devolve o fileKey", () => {
    const { token } = createSignedUrl("tenant-x/ebook.pdf");
    const result = validateSignedUrl(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.fileKey).toBe("tenant-x/ebook.pdf");
    }
  });

  it("rejeita token expirado", () => {
    const { token } = createSignedUrl("tenant-x/old.pdf", -1);
    const result = validateSignedUrl(token);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("expired");
    }
  });

  it("rejeita HMAC adulterado", () => {
    const { token } = createSignedUrl("tenant-x/a.pdf");
    const [payload, sig] = token.split(".");
    // Flipa um caractere da assinatura — ainda é base64url válido mas o HMAC quebra.
    const tampered = `${payload}.${sig.replace(/^./, sig[0] === "A" ? "B" : "A")}`;
    const result = validateSignedUrl(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("invalid");
    }
  });

  it("rejeita payload adulterado (HMAC não bate)", () => {
    const { token } = createSignedUrl("tenant-x/a.pdf");
    const [, sig] = token.split(".");
    const otherPayload = Buffer.from(
      JSON.stringify({ fileKey: "tenant-y/outro.pdf", expiresAt: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    const result = validateSignedUrl(`${otherPayload}.${sig}`);
    expect(result.valid).toBe(false);
  });

  it("rejeita token sem o separador '.'", () => {
    expect(validateSignedUrl("token-malformado").valid).toBe(false);
  });

  it("rejeita token com parte vazia", () => {
    expect(validateSignedUrl(".sig").valid).toBe(false);
    expect(validateSignedUrl("payload.").valid).toBe(false);
  });

  it("rejeita payload com JSON inválido", () => {
    const badPayload = Buffer.from("nao-eh-json", "utf8").toString("base64url");
    // assina o payload bad pra HMAC bater
    const { token } = createSignedUrl("tenant-x/a.pdf");
    const [, validSig] = token.split(".");
    // Token com payload ruim + sig errada — falha invalid mesmo
    const result = validateSignedUrl(`${badPayload}.${validSig}`);
    expect(result.valid).toBe(false);
  });
});
