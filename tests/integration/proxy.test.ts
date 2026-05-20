import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetTenantCache } from "@/lib/tenant/resolver";
import { proxy } from "@/proxy";

/**
 * Teste comportamental leve do proxy: resolução via DEV_TENANT_SLUG e 404 para
 * tenant inexistente. O ambiente de teste roda fora de produção, então o proxy
 * sempre usa o ramo de dev (DEV_TENANT_SLUG).
 */
describe("proxy de tenant", () => {
  afterEach(() => {
    _resetTenantCache();
    vi.unstubAllEnvs();
  });

  it("resolve o tenant via DEV_TENANT_SLUG (passa adiante: 200)", async () => {
    vi.stubEnv("DEV_TENANT_SLUG", "missa-explicada");
    const response = await proxy(new NextRequest("http://localhost:3000/login"));
    expect(response.status).toBe(200);
  });

  it("responde 404 quando o DEV_TENANT_SLUG não existe", async () => {
    vi.stubEnv("DEV_TENANT_SLUG", "__tenant_inexistente__");
    const response = await proxy(new NextRequest("http://localhost:3000/login"));
    expect(response.status).toBe(404);
  });
});
