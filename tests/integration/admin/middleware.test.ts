import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminLucia } from "@/lib/admin/auth";
import { resolveAdminAccess } from "@/lib/admin/middleware";
import { testPrisma } from "../../helpers/db";

/**
 * Testes da proteção das rotas `/admin/*` via o core `resolveAdminAccess`.
 *
 * `requireAdmin()` em si lê `cookies()` e chama `redirect()` — indisponíveis no
 * vitest. `resolveAdminAccess(sessionId)` é o core que carrega a decisão e é
 * o que se testa aqui.
 */
let activeAdminId = "";
let inactiveAdminId = "";

beforeAll(async () => {
  const active = await testPrisma.adminUser.create({
    data: { email: `mw-active-${randomUUID()}@test.local`, name: "Active", role: "ADMIN" },
  });
  const inactive = await testPrisma.adminUser.create({
    data: {
      email: `mw-inactive-${randomUUID()}@test.local`,
      name: "Inactive",
      role: "ADMIN",
      active: false,
    },
  });
  activeAdminId = active.id;
  inactiveAdminId = inactive.id;
});

afterAll(async () => {
  await testPrisma.adminSession.deleteMany({
    where: { userId: { in: [activeAdminId, inactiveAdminId] } },
  });
  await testPrisma.adminUser.deleteMany({
    where: { id: { in: [activeAdminId, inactiveAdminId] } },
  });
  await testPrisma.$disconnect();
});

describe("resolveAdminAccess", () => {
  it("sem sessionId → no-session", async () => {
    const access = await resolveAdminAccess(null);
    expect(access.status).toBe("no-session");
  });

  it("sessionId inexistente → no-session", async () => {
    const access = await resolveAdminAccess(randomUUID());
    expect(access.status).toBe("no-session");
  });

  it("sessão válida de admin ATIVO → ok com adminUser", async () => {
    const session = await adminLucia.createSession(activeAdminId, {});
    const access = await resolveAdminAccess(session.id);
    expect(access.status).toBe("ok");
    if (access.status === "ok") {
      expect(access.adminUser.id).toBe(activeAdminId);
    }
  });

  it("sessão válida de admin INATIVO → inactive + sessão invalidada", async () => {
    const session = await adminLucia.createSession(inactiveAdminId, {});
    const access = await resolveAdminAccess(session.id);
    expect(access.status).toBe("inactive");

    // A sessão do admin inativo foi invalidada na hora.
    const row = await testPrisma.adminSession.findUnique({ where: { id: session.id } });
    expect(row).toBeNull();
  });

  it("sessão expirada → no-session", async () => {
    const session = await adminLucia.createSession(activeAdminId, {});
    await testPrisma.adminSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 10_000) },
    });
    const access = await resolveAdminAccess(session.id);
    expect(access.status).toBe("no-session");
  });
});
