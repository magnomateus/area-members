import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logAdminAction } from "@/lib/admin/audit";
import { testPrisma } from "../../helpers/db";

/**
 * Testes do audit log do admin (`logAdminAction` → `AdminAuditLog`).
 * As linhas de teste usam `entityId` prefixado com um id de run para limpeza.
 */
const RUN = randomUUID();
let adminUserId = "";

beforeAll(async () => {
  const admin = await testPrisma.adminUser.create({
    data: { email: `audit-${randomUUID()}@test.local`, name: "Audit Test", role: "ADMIN" },
  });
  adminUserId = admin.id;
});

afterAll(async () => {
  await testPrisma.adminAuditLog.deleteMany({ where: { entityId: { startsWith: RUN } } });
  await testPrisma.adminUser.delete({ where: { id: adminUserId } });
  await testPrisma.$disconnect();
});

describe("logAdminAction", () => {
  it("grava todos os campos (action, entity, before/after, reason, ip, ua)", async () => {
    const entityId = `${RUN}-full`;
    const before = Date.now();
    await logAdminAction({
      adminUserId,
      action: "ENTITLEMENT_SUSPENDED",
      entityType: "Entitlement",
      entityId,
      before: { status: "ACTIVE" },
      after: { status: "SUSPENDED" },
      reason: "teste de auditoria",
      ipAddress: "203.0.113.42",
      userAgent: "vitest-agent",
    });

    const row = await testPrisma.adminAuditLog.findFirst({ where: { entityId } });
    expect(row).not.toBeNull();
    expect(row?.adminUserId).toBe(adminUserId);
    expect(row?.action).toBe("ENTITLEMENT_SUSPENDED");
    expect(row?.entityType).toBe("Entitlement");
    expect(row?.before).toEqual({ status: "ACTIVE" });
    expect(row?.after).toEqual({ status: "SUSPENDED" });
    expect(row?.reason).toBe("teste de auditoria");
    expect(row?.ipAddress).toBe("203.0.113.42");
    expect(row?.userAgent).toBe("vitest-agent");
    // createdAt indexado e preenchido pelo banco.
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("aceita adminUserId null (tentativas anônimas/falhas — decisão E)", async () => {
    const entityId = `${RUN}-anon`;
    await logAdminAction({
      action: "ADMIN_LOGIN_FAILED",
      entityType: "AdminUser",
      entityId,
      reason: "invalid",
    });

    const row = await testPrisma.adminAuditLog.findFirst({ where: { entityId } });
    expect(row).not.toBeNull();
    expect(row?.adminUserId).toBeNull();
    expect(row?.action).toBe("ADMIN_LOGIN_FAILED");
    // Campos opcionais ausentes ficam null.
    expect(row?.ipAddress).toBeNull();
    expect(row?.before).toBeNull();
  });
});
