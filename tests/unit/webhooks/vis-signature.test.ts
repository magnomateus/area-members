import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookV1 } from "@/lib/webhooks/vis-signature";

const SECRET = "test-secret-abc-123";

function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

function signV1(rawBody: string, secret: string, ts: number): string {
  const v1 = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

function hashOf(header: string): string {
  return header.split("v1=")[1];
}

function flipHexChar(hex: string, index: number): string {
  const current = hex[index];
  const replacement = current === "0" ? "1" : "0";
  return hex.slice(0, index) + replacement + hex.slice(index + 1);
}

function measureNs(iterations: number, fn: () => void): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn();
  return Number(process.hrtime.bigint() - start);
}

describe("verifyWebhookV1", () => {
  const body = JSON.stringify({ event: "order.approved", data: { order_id: 1 } });

  it("aceita uma assinatura V1 válida", () => {
    const result = verifyWebhookV1(signV1(body, SECRET, nowTs()), body, SECRET);
    expect(result.valid).toBe(true);
  });

  it("rejeita timestamp velho (> 300s) — too_old", () => {
    const result = verifyWebhookV1(signV1(body, SECRET, nowTs() - 400), body, SECRET);
    expect(result).toEqual({ valid: false, reason: "too_old" });
  });

  it("rejeita timestamp no futuro (> 30s) — too_future", () => {
    const result = verifyWebhookV1(signV1(body, SECRET, nowTs() + 120), body, SECRET);
    expect(result).toEqual({ valid: false, reason: "too_future" });
  });

  it("rejeita hash incorreto — mismatch", () => {
    const ts = nowTs();
    const tampered = `t=${ts},v1=${flipHexChar(hashOf(signV1(body, SECRET, ts)), 10)}`;
    expect(verifyWebhookV1(tampered, body, SECRET)).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejeita assinatura feita com outro secret — mismatch", () => {
    const result = verifyWebhookV1(signV1(body, "outro-secret", nowTs()), body, SECRET);
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejeita header malformado — malformed", () => {
    expect(verifyWebhookV1("isto-nao-e-valido", body, SECRET).valid).toBe(false);
    expect(verifyWebhookV1("t=abc,v1=xyz", body, SECRET)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejeita header ausente — malformed", () => {
    expect(verifyWebhookV1(null, body, SECRET)).toEqual({ valid: false, reason: "malformed" });
    expect(verifyWebhookV1(undefined, body, SECRET)).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejeita body adulterado (assinatura não bate)", () => {
    const header = signV1(body, SECRET, nowTs());
    expect(verifyWebhookV1(header, `${body} `, SECRET)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("comparação do hash é timing-safe (mismatch detectado em qualquer posição)", () => {
    const ts = nowTs();
    const validHash = hashOf(signV1(body, SECRET, ts));
    const wrongFirst = `t=${ts},v1=${flipHexChar(validHash, 0)}`;
    const wrongLast = `t=${ts},v1=${flipHexChar(validHash, validHash.length - 1)}`;

    // Correção: a diferença é detectada independente da posição.
    expect(verifyWebhookV1(wrongFirst, body, SECRET).valid).toBe(false);
    expect(verifyWebhookV1(wrongLast, body, SECRET).valid).toBe(false);

    // Timing: comparação de tempo entre near-miss e far-miss (tolerância ampla
    // — a garantia real vem de crypto.timingSafeEqual).
    const iterations = 4_000;
    const tFirst = measureNs(iterations, () => verifyWebhookV1(wrongFirst, body, SECRET));
    const tLast = measureNs(iterations, () => verifyWebhookV1(wrongLast, body, SECRET));
    const ratio = Math.max(tFirst, tLast) / Math.max(Math.min(tFirst, tLast), 1);
    expect(ratio).toBeLessThan(3);
  });
});
