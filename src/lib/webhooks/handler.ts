import { createHash } from "node:crypto";
import { type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveTenantFromWebhook, resolveWebhookSecret } from "@/lib/webhooks/vis-resolver";
import { routeWebhookEvent } from "@/lib/webhooks/vis-router";
import { verifyWebhookV1 } from "@/lib/webhooks/vis-signature";
import { isVisWebhookPayload, type VisWebhookPayload } from "@/lib/webhooks/types";

/**
 * Handler core do webhook da VIS (sub-fase 1.3a — sem provisionamento).
 *
 * Compartilhado entre `POST /api/webhooks/vis` (com HMAC) e o `/simulate`
 * (com `skipSignature`). Ver WEBHOOK_CONTRACT.md seção 8.
 */
type DbClient = Prisma.TransactionClient;

export interface WebhookHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

interface HandlerOptions {
  client?: DbClient;
  skipSignature?: boolean;
}

// Alerta de tráfego: > 100 webhooks/min do mesmo tenant (não bloqueia, sinaliza).
const TRAFFIC_WINDOW_MS = 60_000;
const TRAFFIC_ALERT_THRESHOLD = 100;
const tenantTraffic = new Map<string, number[]>();

function recordTrafficAndCheck(tenantId: string): number {
  const now = Date.now();
  const recent = (tenantTraffic.get(tenantId) ?? []).filter((t) => now - t < TRAFFIC_WINDOW_MS);
  recent.push(now);
  tenantTraffic.set(tenantId, recent);
  return recent.length;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function writeEventLog(
  client: DbClient,
  entry: {
    type: string;
    level: "info" | "warn" | "error";
    message: string;
    payload: Prisma.InputJsonValue;
    tenantId?: string | null;
  },
): Promise<void> {
  await client.eventLog.create({
    data: {
      type: entry.type,
      level: entry.level,
      message: entry.message,
      payload: entry.payload,
      tenantId: entry.tenantId ?? null,
    },
  });
}

async function markDeliveryProcessed(
  client: DbClient,
  deliveryId: string,
  fields: {
    signatureValid: boolean;
    signatureReason?: string | null;
    tenantId?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await client.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      processed: true,
      processedAt: new Date(),
      signatureValid: fields.signatureValid,
      signatureReason: fields.signatureReason ?? null,
      tenantId: fields.tenantId ?? null,
      errorMessage: fields.errorMessage ?? null,
    },
  });
}

export async function handleVisWebhook(
  rawBody: string,
  headers: Headers,
  opts: HandlerOptions = {},
): Promise<WebhookHandlerResult> {
  const client: DbClient = opts.client ?? prisma;
  const skipSignature = opts.skipSignature ?? false;

  const payloadHash = sha256(rawBody);
  const headerEvent = headers.get("x-webhook-event");
  const visDeliveryId = headers.get("x-webhook-delivery-id");
  const signatureHeader = headers.get("x-webhook-signature-v1");
  const rawHeaders = headersToObject(headers);

  // Parse defensivo do JSON.
  let payload: VisWebhookPayload | null = null;
  let parsedRaw: unknown = null;
  try {
    parsedRaw = JSON.parse(rawBody);
    if (isVisWebhookPayload(parsedRaw)) {
      payload = parsedRaw;
    }
  } catch {
    parsedRaw = null;
  }

  // Idempotência camada 2: UPSERT por payloadHash.
  const delivery = await client.webhookDelivery.upsert({
    where: { payloadHash },
    create: {
      tenantId: null,
      visEvent: headerEvent ?? payload?.event ?? "unknown",
      visDeliveryId: visDeliveryId ?? null,
      signatureValid: false,
      payloadHash,
      rawPayload: (parsedRaw ?? { _unparseable: rawBody.slice(0, 5_000) }) as Prisma.InputJsonValue,
      rawHeaders: rawHeaders as Prisma.InputJsonValue,
      processed: false,
    },
    update: {},
  });

  if (delivery.processed) {
    return { status: 200, body: { ok: true, duplicate: true, deliveryId: delivery.id } };
  }

  // JSON inválido → 400 (erro permanente, VIS não retenta).
  if (!payload) {
    await markDeliveryProcessed(client, delivery.id, {
      signatureValid: false,
      errorMessage: "JSON inválido",
    });
    await writeEventLog(client, {
      type: "webhook.invalid_json",
      level: "warn",
      message: "Webhook recebido com JSON inválido.",
      payload: { payloadHash },
    });
    return { status: 400, body: { ok: false, error: "JSON inválido" } };
  }

  // Idempotência camada 3: mesmo visDeliveryId já processado.
  if (visDeliveryId) {
    const prior = await client.webhookDelivery.findFirst({
      where: { visDeliveryId, processed: true, id: { not: delivery.id } },
    });
    if (prior) {
      await markDeliveryProcessed(client, delivery.id, {
        signatureValid: false,
        errorMessage: "visDeliveryId duplicado",
      });
      return { status: 200, body: { ok: true, duplicate: true, deliveryId: delivery.id } };
    }
  }

  const event = payload.event ?? "unknown";
  const fullPayload = parsedRaw as Prisma.InputJsonValue;

  // ── Resolução de tenant (comum a webhook.test e demais eventos) ──
  const tenant = await resolveTenantFromWebhook(payload, client);
  if (!tenant) {
    await markDeliveryProcessed(client, delivery.id, {
      signatureValid: false,
      errorMessage: "tenant não resolvível",
    });
    await writeEventLog(client, {
      type: "webhook.tenant_unresolved",
      level: "warn",
      message: `Webhook '${event}' sem tenant resolvível (src/products).`,
      payload: fullPayload,
    });
    return {
      status: 400,
      body: { ok: false, error: "Tenant não resolvível a partir do payload." },
    };
  }

  // Alerta de tráfego (não bloqueia).
  const trafficCount = recordTrafficAndCheck(tenant.id);
  if (trafficCount > TRAFFIC_ALERT_THRESHOLD) {
    await writeEventLog(client, {
      type: "webhook.traffic_spike",
      level: "warn",
      message: `Tenant ${tenant.slug} recebeu ${trafficCount} webhooks no último minuto.`,
      payload: { tenantId: tenant.id, count: trafficCount },
      tenantId: tenant.id,
    });
  }

  // ── Validação do webhook secret + HMAC ──
  let signatureValid = false;
  let signatureReason: string | null = null;

  if (!skipSignature) {
    const secretResolution = await resolveWebhookSecret(payload, client);
    if (secretResolution.secret === null) {
      await markDeliveryProcessed(client, delivery.id, {
        signatureValid: false,
        tenantId: tenant.id,
        errorMessage: `webhook secret ausente (${secretResolution.reason})`,
      });
      await writeEventLog(client, {
        type: "webhook.no_secret_configured",
        level: "error",
        message: `Sem webhook secret para validar '${event}' (${secretResolution.reason}).`,
        payload: fullPayload,
        tenantId: tenant.id,
      });
      return { status: 401, body: { ok: false, error: "Webhook secret não configurado." } };
    }

    // Header V1 ausente → 400; presente mas inválido → 401.
    if (!signatureHeader) {
      await markDeliveryProcessed(client, delivery.id, {
        signatureValid: false,
        signatureReason: "malformed",
        tenantId: tenant.id,
        errorMessage: "header X-Webhook-Signature-V1 ausente",
      });
      await writeEventLog(client, {
        type: "webhook.signature_missing",
        level: "warn",
        message: `Webhook '${event}' sem header X-Webhook-Signature-V1.`,
        payload: fullPayload,
        tenantId: tenant.id,
      });
      return { status: 400, body: { ok: false, error: "Header X-Webhook-Signature-V1 ausente." } };
    }

    const check = verifyWebhookV1(signatureHeader, rawBody, secretResolution.secret);
    if (!check.valid) {
      await markDeliveryProcessed(client, delivery.id, {
        signatureValid: false,
        signatureReason: check.reason,
        tenantId: tenant.id,
        errorMessage: `assinatura inválida: ${check.reason}`,
      });
      await writeEventLog(client, {
        type: "webhook.signature_invalid",
        level: "warn",
        message: `Webhook '${event}' com assinatura inválida (${check.reason}).`,
        payload: fullPayload,
        tenantId: tenant.id,
      });
      return { status: 401, body: { ok: false, error: "Assinatura inválida." } };
    }
    signatureValid = true;
  } else {
    // Modo simulador: sem validação de HMAC.
    signatureReason = "skipped_simulator";
  }

  // ── webhook.test: caminho especial, NÃO provisiona ──
  if (event === "webhook.test") {
    await markDeliveryProcessed(client, delivery.id, {
      signatureValid,
      signatureReason,
      tenantId: tenant.id,
    });
    await writeEventLog(client, {
      type: "webhook.test.received",
      level: "info",
      message: `Webhook de teste recebido e validado (tenant ${tenant.slug}).`,
      payload: fullPayload,
      tenantId: tenant.id,
    });
    return {
      status: 200,
      body: {
        ok: true,
        event: "webhook.test",
        message: "Test received and validated",
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        receivedAt: new Date().toISOString(),
        signatureValid,
        deliveryId: delivery.id,
      },
    };
  }

  // ── Demais eventos: roteamento (stubs na 1.3a) ──
  const routed = await routeWebhookEvent({ payload, tenant, client });

  await markDeliveryProcessed(client, delivery.id, {
    signatureValid,
    signatureReason,
    tenantId: tenant.id,
  });
  await writeEventLog(client, {
    type: `webhook.${event}`,
    level: routed.logLevel,
    message: `Webhook '${event}' processado: ${routed.action} (${routed.note}).`,
    payload: fullPayload,
    tenantId: tenant.id,
  });

  // Campos seguros do roteamento — o AccessToken NUNCA entra no response.
  const body: Record<string, unknown> = {
    ok: true,
    event,
    action: routed.action,
    note: routed.note,
    deliveryId: delivery.id,
  };
  if (routed.userId) body.userId = routed.userId;
  if (routed.orderId) body.orderId = routed.orderId;
  if (routed.entitlementsCreated !== undefined) {
    body.entitlementsCreated = routed.entitlementsCreated;
  }
  if (routed.accessTokenGenerated !== undefined) {
    body.accessTokenGenerated = routed.accessTokenGenerated;
  }

  return { status: 200, body };
}
