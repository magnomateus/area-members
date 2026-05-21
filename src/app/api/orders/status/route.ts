import { OrderStatus } from "@prisma/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateAccessToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";

/**
 * GET /api/orders/status?order_id=<int>&email=<email>
 *
 * Endpoint de polling da página de obrigado (a página é a sub-fase 1.4).
 * Sem autenticação. **Sempre responde 200** (anti-enumeração) — exceto 429
 * no rate limit. Ver WEBHOOK_CONTRACT.md seção 9.
 */
const querySchema = z.object({
  order_id: z.coerce.number().int().positive(),
  email: z.string().email(),
});

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ipHits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  return false;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (isRateLimited(clientIp(request))) {
    return NextResponse.json({ error: "Muitas requisições." }, { status: 429 });
  }

  const parsed = querySchema.safeParse({
    order_id: request.nextUrl.searchParams.get("order_id"),
    email: request.nextUrl.searchParams.get("email"),
  });
  // Params inválidos → 'pending' (não revela nada).
  if (!parsed.success) {
    return NextResponse.json({ status: "pending" }, { status: 200 });
  }

  const order = await prisma.order.findUnique({
    where: { visOrderId: parsed.data.order_id },
    include: { user: true },
  });

  // Order inexistente OU email não confere → 'pending' (anti-enumeração).
  if (!order || order.user.email.toLowerCase() !== parsed.data.email.trim().toLowerCase()) {
    return NextResponse.json({ status: "pending" }, { status: 200 });
  }

  if (order.status === OrderStatus.REFUSED || order.status === OrderStatus.CANCELLED) {
    return NextResponse.json(
      { status: "failed", reason: order.status.toLowerCase() },
      { status: 200 },
    );
  }

  if (order.status === OrderStatus.APPROVED && order.provisioned) {
    // Reusa o AccessToken válido mais recente; se não houver, gera um novo.
    const existingToken = await prisma.accessToken.findFirst({
      where: { orderId: order.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    const token = existingToken
      ? existingToken.token
      : (await generateAccessToken(order.userId, order.id)).token;

    return NextResponse.json(
      { status: "ready", accessToken: token, redirectUrl: `/auth/redeem?t=${token}` },
      { status: 200 },
    );
  }

  // PENDING / CREATED / REFUNDED / CHARGEDBACK → ainda 'pending' para o polling.
  return NextResponse.json({ status: "pending" }, { status: 200 });
}
