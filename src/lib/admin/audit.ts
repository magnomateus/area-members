import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Audit log de ações do admin — `AdminAuditLog`.
 *
 * Tabela dedicada (separada do `EventLog`): registra QUEM fez O QUÊ, em QUAL
 * entidade, com valores `before`/`after` e `reason`. Ver docs/PHASES.md
 * "Sub-fase 5.0".
 *
 * `adminUserId` é opcional: tentativas anônimas/falhas (email inexistente,
 * token inválido) também são auditadas — e nesses casos não há admin resolvido.
 */
export interface LogAdminActionParams {
  adminUserId?: string | null;
  action: string; // ex: "ADMIN_LOGIN_SUCCESS", "PRODUCT_DELETED"
  entityType: string; // ex: "AdminSession", "Product"
  entityId: string; // id da entidade afetada
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminUserId: params.adminUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before,
      after: params.after,
      reason: params.reason,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}
