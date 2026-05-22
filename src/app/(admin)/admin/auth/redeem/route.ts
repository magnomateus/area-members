import { type NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin/audit";
import {
  AdminMagicLinkExpiredError,
  AdminMagicLinkNotFoundError,
  AdminMagicLinkUsedError,
  validateAdminMagicLink,
} from "@/lib/admin/magic-link";
import { createAdminSession } from "@/lib/admin/session";
import { prisma } from "@/lib/db";

/**
 * GET /admin/auth/redeem?t=<token>
 *
 * Consome o magic link do admin, cria a sessão (`admin_session`) e redireciona
 * para `/admin`. É um Route Handler (não page) porque só Route Handlers gravam
 * cookies — mesmo padrão do `/auth/redeem` do cliente (Fase 1.4).
 *
 * Erros redirecionam para `/admin/login?error=…` e auditam ADMIN_LOGIN_FAILED.
 */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");
  const token = request.nextUrl.searchParams.get("t");

  if (!token) {
    return NextResponse.redirect(new URL("/admin/login?error=invalid", request.url));
  }

  try {
    const { adminUserId } = await validateAdminMagicLink(token);

    // O admin pode ter sido desativado entre a solicitação e o resgate.
    const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
    if (!admin?.active) {
      await logAdminAction({
        adminUserId,
        action: "ADMIN_LOGIN_FAILED",
        entityType: "AdminUser",
        entityId: adminUserId,
        reason: "inactive",
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.redirect(new URL("/admin/login?error=inactive", request.url));
    }

    const sessionId = await createAdminSession(adminUserId, { ipAddress: ip, userAgent });
    await logAdminAction({
      adminUserId,
      action: "ADMIN_LOGIN_SUCCESS",
      entityType: "AdminSession",
      entityId: sessionId,
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.redirect(new URL("/admin", request.url));
  } catch (error) {
    if (error instanceof AdminMagicLinkExpiredError) {
      await logAdminAction({
        adminUserId: error.adminUserId,
        action: "ADMIN_LOGIN_FAILED",
        entityType: "AdminUser",
        entityId: error.adminUserId,
        reason: "expired",
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.redirect(new URL("/admin/login?error=expired", request.url));
    }
    if (error instanceof AdminMagicLinkUsedError) {
      await logAdminAction({
        adminUserId: error.adminUserId,
        action: "ADMIN_LOGIN_FAILED",
        entityType: "AdminUser",
        entityId: error.adminUserId,
        reason: "used",
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.redirect(new URL("/admin/login?error=used", request.url));
    }
    if (error instanceof AdminMagicLinkNotFoundError) {
      await logAdminAction({
        adminUserId: null,
        action: "ADMIN_LOGIN_FAILED",
        entityType: "AdminUser",
        entityId: "unknown",
        reason: "invalid",
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.redirect(new URL("/admin/login?error=invalid", request.url));
    }
    // Erro inesperado — trata como link inválido (não vaza detalhe).
    console.error(
      "[admin redeem] erro inesperado:",
      error instanceof Error ? error.name : "desconhecido",
    );
    return NextResponse.redirect(new URL("/admin/login?error=invalid", request.url));
  }
}
