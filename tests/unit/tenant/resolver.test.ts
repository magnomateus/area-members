import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { _resetTenantCache, resolveTenantBySlug } from "@/lib/tenant/resolver";

/**
 * Testes do resolver de tenant. Leituras sobre o tenant de seed
 * (`missa-explicada`) — não alteram o banco.
 */
describe("resolver de tenant", () => {
  afterEach(() => {
    _resetTenantCache();
    vi.restoreAllMocks();
  });

  it("resolve o tenant Missa Explicada pelo slug", async () => {
    const tenant = await resolveTenantBySlug("missa-explicada");
    expect(tenant).not.toBeNull();
    expect(tenant?.name).toBe("Missa Explicada");
  });

  it("retorna null para slug inexistente", async () => {
    const tenant = await resolveTenantBySlug("__slug_inexistente__");
    expect(tenant).toBeNull();
  });

  it("serve a 2ª chamada do cache (uma única query no banco)", async () => {
    const spy = vi.spyOn(prisma.tenant, "findUnique");
    await resolveTenantBySlug("missa-explicada");
    await resolveTenantBySlug("missa-explicada");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
