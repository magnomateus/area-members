import { type NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin/audit";
import { getAdminSession, invalidateAdminSession } from "@/lib/admin/session";

/**
 * GET /api/admin/auth/logout
 *
 * Encerra a sessão do admin: audita ADMIN_LOGOUT, invalida a sessão no banco,
 * limpa o cookie `admin_session` e redireciona para `/admin/login`.
 */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (session) {
    await logAdminAction({
      adminUserId: session.adminUser.id,
      action: "ADMIN_LOGOUT",
      entityType: "AdminSession",
      entityId: session.session.id,
      ipAddress: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
  }
  await invalidateAdminSession();
  return NextResponse.redirect(new URL("/admin/login", request.url));
}
