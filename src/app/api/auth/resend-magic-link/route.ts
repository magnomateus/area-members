import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildRedeemUrl, generateAccessToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { getCurrentTenantId } from "@/lib/tenant/context";

/**
 * POST /api/auth/resend-magic-link  — body: { order_id, email }
 *
 * Reenvia o magic link de uma Order existente. Anti-enumeração: responde
 * SEMPRE 200 (exceto 400 de body inválido e 429 de rate limit) e nunca revela
 * se a Order/email existem. Rate limit: 3/hora por (order_id, email) — chave
 * por pedido, não por IP, pois quem chama é o cliente legítimo.
 */
const bodySchema = z.object({
  order_id: z.number().int().positive(),
  email: z.string().email(),
});

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    attempts.set(key, recent);
    return true;
  }
  recent.push(now);
  attempts.set(key, recent);
  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const { order_id: orderId, email } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  if (isRateLimited(`${String(orderId)}:${normalizedEmail}`)) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde alguns minutos." },
      { status: 429 },
    );
  }

  const tenantId = await getCurrentTenantId();
  const order = tenantId
    ? await prisma.order.findFirst({
        where: { visOrderId: orderId, tenantId },
        include: { user: true },
      })
    : null;

  if (order && order.user.email.toLowerCase() === normalizedEmail) {
    const { token } = await generateAccessToken(order.userId, order.id);
    // Envio real (WhatsApp/email) chega na sub-fase 1.6 — por ora, só console em dev.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[NOTIFICATION STUB] resend -> ${buildRedeemUrl(token, request.nextUrl.origin)}`);
    }
    await prisma.eventLog.create({
      data: {
        tenantId,
        type: "magic_link.resent",
        level: "info",
        message: `Magic link reenviado para a order ${String(orderId)}.`,
        payload: { orderId: order.id },
        userId: order.userId,
        orderId: order.id,
      },
    });
  } else {
    // Anti-enumeração: registra, mas a resposta é idêntica ao caso de sucesso.
    await prisma.eventLog.create({
      data: {
        tenantId,
        type: "magic_link.resend_unknown",
        level: "warn",
        message: "Resend solicitado para order/email não encontrado.",
        payload: { order_id: orderId, email: normalizedEmail },
      },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
