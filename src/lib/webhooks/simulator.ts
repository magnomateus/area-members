import { randomUUID } from "node:crypto";
import type { VisWebhookData, VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * Geração de payloads sintéticos para o endpoint `/api/webhooks/vis/simulate`
 * (apenas dev). Os payloads são estruturalmente válidos e resolvem para o
 * tenant `missa-explicada` via o produto DEV (visProductId 99999).
 */
export type SimulatorPreset =
  | "approved"
  | "refunded"
  | "cancelled"
  | "chargedback"
  | "webhook.test";

const PRESETS: readonly SimulatorPreset[] = [
  "approved",
  "refunded",
  "cancelled",
  "chargedback",
  "webhook.test",
];

export function isSimulatorPreset(value: unknown): value is SimulatorPreset {
  return typeof value === "string" && (PRESETS as readonly string[]).includes(value);
}

export function buildPresetPayload(preset: SimulatorPreset): VisWebhookPayload {
  const now = new Date().toISOString();

  const data: VisWebhookData = {
    order_id: 778001,
    uuid: `sim-${randomUUID()}`,
    status: "approved",
    payment_id: "pi_simulado_0000",
    payment_method: "credit_card",
    payment_gateway: "stripe",
    total: 197.0,
    subtotal: 197.0,
    discount: 0,
    customer: {
      name: "Cliente Simulado",
      email: "simulado@dev.local",
      phone: "5511999999999",
      cpf: "12345678900",
    },
    products: [{ id: 99999, name: "Missa Explicada DEV", quantity: 1, price: 197.0 }],
    tracking: { src: "tenant_missa-explicada", sck: null },
    created_at: now,
    paid_at: now,
    refunded_at: null,
  };

  let event = "order.approved";
  let test = false;

  switch (preset) {
    case "approved":
      break;
    case "refunded":
      event = "order.refunded";
      data.status = "refunded";
      data.refunded_at = now;
      break;
    case "cancelled":
      event = "order.cancelled";
      data.status = "cancelled";
      break;
    case "chargedback":
      event = "order.chargedback";
      data.status = "chargedback";
      break;
    case "webhook.test":
      event = "webhook.test";
      test = true;
      data.order_id = 0;
      data.payment_gateway = "teste";
      data.customer = { ...data.customer, name: "Cliente de Teste" };
      // src "tenant_exemplo" nao resolve — cai no fallback products[0].id.
      data.tracking = { src: "tenant_exemplo", sck: null };
      break;
  }

  return { event, test, timestamp: now, data };
}

/** Mescla overrides sobre um payload base (nível raiz + `data`). */
export function applyOverrides(
  base: VisWebhookPayload,
  overrides: VisWebhookPayload,
): VisWebhookPayload {
  return {
    ...base,
    ...overrides,
    data: { ...base.data, ...overrides.data },
  };
}
