import { type NextRequest, NextResponse } from "next/server";
import { handleVisWebhook } from "@/lib/webhooks/handler";
import { applyOverrides, buildPresetPayload, isSimulatorPreset } from "@/lib/webhooks/simulator";
import { isVisWebhookPayload, type VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * POST /api/webhooks/vis/simulate — apenas DESENVOLVIMENTO.
 *
 * Gate triplo (defense in depth): NODE_ENV != production, env
 * ENABLE_WEBHOOK_SIMULATOR == "true", e a checagem aqui no próprio handler.
 * NÃO valida HMAC (atalho de dev). Ver WEBHOOK_CONTRACT.md seção 10.
 *
 * Body: `{ preset, overrides? }` ou `{ payload }`.
 */
const NOT_FOUND = { error: "not found" };

function simulatorEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_WEBHOOK_SIMULATOR === "true";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!simulatorEnabled()) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "body deve ser um objeto" }, { status: 400 });
  }

  const input = body as { preset?: unknown; overrides?: unknown; payload?: unknown };

  let payload: VisWebhookPayload;
  if (input.payload !== undefined) {
    if (!isVisWebhookPayload(input.payload)) {
      return NextResponse.json({ ok: false, error: "'payload' inválido" }, { status: 400 });
    }
    payload = input.payload;
  } else if (isSimulatorPreset(input.preset)) {
    payload = buildPresetPayload(input.preset);
    if (isVisWebhookPayload(input.overrides)) {
      payload = applyOverrides(payload, input.overrides);
    }
  } else {
    return NextResponse.json(
      {
        ok: false,
        error:
          "informe 'preset' (approved | refunded | cancelled | chargedback | webhook.test) ou 'payload'",
      },
      { status: 400 },
    );
  }

  const rawBody = JSON.stringify(payload);
  const simHeaders = new Headers({
    "content-type": "application/json",
    "x-webhook-event": payload.event ?? "unknown",
    "x-webhook-delivery-id": `sim-${Date.now().toString()}`,
  });

  const result = await handleVisWebhook(rawBody, simHeaders, { skipSignature: true });
  return NextResponse.json(
    {
      simulated: true,
      preset: isSimulatorPreset(input.preset) ? input.preset : null,
      ...result.body,
    },
    { status: result.status },
  );
}
