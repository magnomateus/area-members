import { describe, expect, it } from "vitest";
import { resolveTenantFromWebhook, resolveWebhookSecret } from "@/lib/webhooks/vis-resolver";
import type { VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * Testes do resolver de webhook. Leituras sobre os dados de seed (tenant
 * `missa-explicada`, Offer 99999 com secret, Offer 20 sem secret) — sem escrita.
 */
function payloadWith(opts: { src?: string; productId?: number }): VisWebhookPayload {
  return {
    event: "order.approved",
    data: {
      tracking: opts.src === undefined ? {} : { src: opts.src },
      products: opts.productId === undefined ? [] : [{ id: opts.productId }],
    },
  };
}

describe("resolveTenantFromWebhook", () => {
  it("resolve via src no formato tenant_<slug>", async () => {
    const tenant = await resolveTenantFromWebhook(payloadWith({ src: "tenant_missa-explicada" }));
    expect(tenant?.slug).toBe("missa-explicada");
  });

  it("resolve via fallback products[0].id quando src está ausente", async () => {
    const tenant = await resolveTenantFromWebhook(payloadWith({ productId: 99999 }));
    expect(tenant?.slug).toBe("missa-explicada");
  });

  it("retorna null quando products[0].id é desconhecido e não há src", async () => {
    const tenant = await resolveTenantFromWebhook(payloadWith({ productId: 888_000_888 }));
    expect(tenant).toBeNull();
  });

  it("cai no fallback de products quando o src tem formato inválido", async () => {
    const tenant = await resolveTenantFromWebhook(
      payloadWith({ src: "formato-invalido", productId: 99999 }),
    );
    expect(tenant?.slug).toBe("missa-explicada");
  });
});

describe("resolveWebhookSecret", () => {
  it("retorna o secret do Offer DEV (visProductId 99999)", async () => {
    const result = await resolveWebhookSecret(payloadWith({ productId: 99999 }));
    expect(result.secret).toBe("dev-webhook-secret-for-testing-only");
  });

  it("retorna no_secret_configured quando o Offer existe sem secret (produto 20)", async () => {
    const result = await resolveWebhookSecret(payloadWith({ productId: 20 }));
    expect(result).toEqual({ secret: null, reason: "no_secret_configured" });
  });

  it("retorna no_offer quando nenhum produto tem Offer correspondente", async () => {
    const result = await resolveWebhookSecret(payloadWith({ productId: 888_000_888 }));
    expect(result).toEqual({ secret: null, reason: "no_offer" });
  });
});
