import type { Tenant } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildSupportWhatsappUrl } from "@/lib/support/whatsapp";

function fakeTenant(supportWhatsapp: string | null): Tenant {
  return {
    id: "tenant-id",
    slug: "tenant-slug",
    name: "Tenant",
    domain: null,
    branding: {},
    supportWhatsapp,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("buildSupportWhatsappUrl", () => {
  it("monta a URL wa.me com o número do pedido interpolado", () => {
    const url = buildSupportWhatsappUrl(fakeTenant("5562994350583"), 3678);
    expect(url).toBe(
      `https://wa.me/5562994350583?text=${encodeURIComponent(
        "Preciso de ajuda com meu pedido #3678",
      )}`,
    );
  });

  it("usa a mensagem custom quando fornecida", () => {
    const url = buildSupportWhatsappUrl(fakeTenant("5562994350583"), 1, "Mensagem especial");
    expect(url).toContain(encodeURIComponent("Mensagem especial"));
  });

  it("usa mensagem genérica quando não há orderId", () => {
    const url = buildSupportWhatsappUrl(fakeTenant("5562994350583"));
    expect(url).toBe(`https://wa.me/5562994350583?text=${encodeURIComponent("Preciso de ajuda")}`);
  });

  it("retorna null quando o tenant não tem supportWhatsapp", () => {
    expect(buildSupportWhatsappUrl(fakeTenant(null), 3678)).toBeNull();
  });
});
