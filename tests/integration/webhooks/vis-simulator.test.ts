import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/vis/simulate/route";
import { applyOverrides, buildPresetPayload, isSimulatorPreset } from "@/lib/webhooks/simulator";
import { testPrisma } from "../../helpers/db";

/**
 * Testes do endpoint simulador. Os casos "habilitado" usam o prisma global
 * (a rota não recebe client injetável) — o que for persistido é limpo no
 * afterAll via `testPrisma`.
 */
const testStart = new Date();
const createdDeliveryIds: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (createdDeliveryIds.length > 0) {
    await testPrisma.eventLog.deleteMany({
      where: { type: "webhook.test.received", createdAt: { gte: testStart } },
    });
    await testPrisma.webhookDelivery.deleteMany({ where: { id: { in: createdDeliveryIds } } });
  }
  await testPrisma.$disconnect();
});

function simulateRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/webhooks/vis/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("endpoint /api/webhooks/vis/simulate", () => {
  it("retorna 404 quando ENABLE_WEBHOOK_SIMULATOR não é 'true'", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_WEBHOOK_SIMULATOR", "false");
    const response = await POST(simulateRequest({ preset: "webhook.test" }));
    expect(response.status).toBe(404);
  });

  it("retorna 404 em produção mesmo com a flag ligada", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_WEBHOOK_SIMULATOR", "true");
    const response = await POST(simulateRequest({ preset: "webhook.test" }));
    expect(response.status).toBe(404);
  });

  it("habilitado: executa o handler para o preset webhook.test", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_WEBHOOK_SIMULATOR", "true");
    const response = await POST(simulateRequest({ preset: "webhook.test" }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.simulated).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.event).toBe("webhook.test");
    if (typeof body.deliveryId === "string") {
      createdDeliveryIds.push(body.deliveryId);
    }
  });

  it("habilitado: rejeita body sem preset nem payload", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_WEBHOOK_SIMULATOR", "true");
    const response = await POST(simulateRequest({ foo: "bar" }));
    expect(response.status).toBe(400);
  });
});

describe("simulator — funções puras", () => {
  it("isSimulatorPreset reconhece presets válidos e rejeita o resto", () => {
    expect(isSimulatorPreset("webhook.test")).toBe(true);
    expect(isSimulatorPreset("approved")).toBe(true);
    expect(isSimulatorPreset("inexistente")).toBe(false);
    expect(isSimulatorPreset(42)).toBe(false);
  });

  it("buildPresetPayload('webhook.test') gera o payload esperado", () => {
    const payload = buildPresetPayload("webhook.test");
    expect(payload.event).toBe("webhook.test");
    expect(payload.test).toBe(true);
    expect(payload.data?.order_id).toBe(0);
    expect(payload.data?.products?.[0]?.id).toBe(99999);
  });

  it("applyOverrides mescla nível raiz e data", () => {
    const merged = applyOverrides(buildPresetPayload("approved"), {
      data: { order_id: 12_345 },
    });
    expect(merged.data?.order_id).toBe(12_345);
    expect(merged.event).toBe("order.approved");
    expect(merged.data?.products?.[0]?.id).toBe(99999);
  });
});
