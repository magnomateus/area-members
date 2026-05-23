import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as redeemGet } from "@/app/(admin)/admin/auth/redeem/route";
import { POST as requestPost } from "@/app/api/admin/auth/request/route";
import { adminLucia } from "@/lib/admin/auth";
import { createAdminMagicLink, validateAdminMagicLink } from "@/lib/admin/magic-link";
import { establishAdminSession, validateAdminSession } from "@/lib/admin/session";
import { testPrisma } from "../../helpers/db";

/**
 * Fluxo de autenticação do admin.
 *
 * `POST /api/admin/auth/request` não usa cookies → testável direto.
 * O caminho de SUCESSO do redeem grava cookie (`cookies()`), indisponível no
 * vitest — por isso o "request → sessão → logout" é exercitado no nível dos
 * cores (`establishAdminSession`/`validateAdminSession`); só os caminhos de
 * erro do redeem são testados via o route handler.
 */
let adminUserId = "";
let adminEmail = "";
const unknownEmail = `unknown-${randomUUID()}@test.local`;

beforeAll(async () => {
  adminEmail = `authflow-${randomUUID()}@test.local`;
  const admin = await testPrisma.adminUser.create({
    data: { email: adminEmail, name: "Auth Flow Test", role: "ADMIN" },
  });
  adminUserId = admin.id;
});

afterAll(async () => {
  await testPrisma.adminAuditLog.deleteMany({ where: { adminUserId } });
  // Prisma JSON path: MySQL usa sintaxe JSONPath (`$.email`), nao array.
  await testPrisma.adminAuditLog.deleteMany({
    where: { after: { path: "$.email", equals: unknownEmail } },
  });
  await testPrisma.adminSession.deleteMany({ where: { userId: adminUserId } });
  await testPrisma.adminMagicLink.deleteMany({ where: { adminUserId } });
  await testPrisma.adminUser.delete({ where: { id: adminUserId } });
  await testPrisma.$disconnect();
});

function requestReq(email: string, ip: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/auth/request", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email }),
  });
}

function redeemReq(token?: string): NextRequest {
  const url = new URL("http://localhost:3000/admin/auth/redeem");
  if (token !== undefined) url.searchParams.set("t", token);
  return new NextRequest(url);
}

describe("POST /api/admin/auth/request", () => {
  it("email de admin → 200 + cria magic link no banco", async () => {
    const res = await requestPost(requestReq(adminEmail, "198.51.100.10"));
    expect(res.status).toBe(200);

    const links = await testPrisma.adminMagicLink.count({ where: { adminUserId } });
    expect(links).toBeGreaterThan(0);
  });

  it("anti-enumeração: email conhecido e desconhecido têm a MESMA resposta", async () => {
    const known = await requestPost(requestReq(adminEmail, "198.51.100.11"));
    const unknown = await requestPost(requestReq(unknownEmail, "198.51.100.12"));

    expect(known.status).toBe(unknown.status);
    const knownBody = (await known.json()) as { message?: string };
    const unknownBody = (await unknown.json()) as { message?: string };
    expect(knownBody.message).toBe(unknownBody.message);
    expect(typeof knownBody.message).toBe("string");
  });

  it("rate limit: 6ª request no mesmo IP em 15min → 429", async () => {
    const ip = "198.51.100.99";
    for (let i = 0; i < 5; i += 1) {
      const res = await requestPost(requestReq(unknownEmail, ip));
      expect(res.status).not.toBe(429);
    }
    const blocked = await requestPost(requestReq(unknownEmail, ip));
    expect(blocked.status).toBe(429);
  });
});

describe("GET /admin/auth/redeem (caminhos de erro)", () => {
  it("sem token → redireciona para /admin/login?error=invalid", async () => {
    const res = await redeemGet(redeemReq());
    expect(res.headers.get("location")).toContain("/admin/login?error=invalid");
  });

  it("token inexistente → /admin/login?error=invalid", async () => {
    const res = await redeemGet(redeemReq(randomUUID()));
    expect(res.headers.get("location")).toContain("/admin/login?error=invalid");
  });
});

describe("fluxo de sessão (cores)", () => {
  it("magic link → validação → sessão → invalidação", async () => {
    // request → token
    const { token } = await createAdminMagicLink(adminUserId);
    const validated = await validateAdminMagicLink(token);
    expect(validated.adminUserId).toBe(adminUserId);

    // redeem (core): cria a sessão com ip/ua e atualiza lastLoginAt
    const session = await establishAdminSession(adminUserId, {
      ipAddress: "203.0.113.7",
      userAgent: "vitest",
    });
    const sessionRow = await testPrisma.adminSession.findUnique({ where: { id: session.id } });
    expect(sessionRow?.ipAddress).toBe("203.0.113.7");
    expect(sessionRow?.userAgent).toBe("vitest");

    const adminRow = await testPrisma.adminUser.findUnique({ where: { id: adminUserId } });
    expect(adminRow?.lastLoginAt).not.toBeNull();

    // sessão válida
    const active = await validateAdminSession(session.id);
    expect(active?.adminUser.id).toBe(adminUserId);

    // logout: invalida → sessão não valida mais
    await adminLucia.invalidateSession(session.id);
    expect(await validateAdminSession(session.id)).toBeNull();
  });
});
