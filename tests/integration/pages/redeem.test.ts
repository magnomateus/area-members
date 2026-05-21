import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/(public)/auth/redeem/route";
import { testPrisma } from "../../helpers/db";

/**
 * Testes do Route Handler /auth/redeem (casos de erro).
 *
 * O caminho de sucesso (token válido → cria sessão → /home) depende de
 * `cookies()` do runtime do Next, indisponível no vitest — fica coberto pelo
 * teste manual E2E.
 */
let userId = "";
const expiredToken = randomUUID();
const usedToken = randomUUID();

beforeAll(async () => {
  const tenant = await testPrisma.tenant.findUniqueOrThrow({ where: { slug: "missa-explicada" } });
  const user = await testPrisma.user.create({
    data: { tenantId: tenant.id, email: `redeem-${randomUUID()}@test.local` },
  });
  userId = user.id;
  await testPrisma.accessToken.create({
    data: { userId, token: expiredToken, expiresAt: new Date(Date.now() - 1000) },
  });
  await testPrisma.accessToken.create({
    data: {
      userId,
      token: usedToken,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await testPrisma.accessToken.deleteMany({ where: { userId } });
  await testPrisma.session.deleteMany({ where: { userId } });
  await testPrisma.user.deleteMany({ where: { id: userId } });
  await testPrisma.$disconnect();
});

function redeemRequest(token?: string): NextRequest {
  const url = new URL("http://localhost:3000/auth/redeem");
  if (token !== undefined) url.searchParams.set("t", token);
  return new NextRequest(url);
}

describe("GET /auth/redeem", () => {
  it("sem token → redireciona para /login?reason=invalid", async () => {
    const res = await GET(redeemRequest());
    expect(res.headers.get("location")).toContain("/login?reason=invalid");
  });

  it("token inexistente → /login?reason=invalid", async () => {
    const res = await GET(redeemRequest(randomUUID()));
    expect(res.headers.get("location")).toContain("/login?reason=invalid");
  });

  it("token expirado → /login?reason=expired", async () => {
    const res = await GET(redeemRequest(expiredToken));
    expect(res.headers.get("location")).toContain("/login?reason=expired");
  });

  it("token já usado → /login?reason=used", async () => {
    const res = await GET(redeemRequest(usedToken));
    expect(res.headers.get("location")).toContain("/login?reason=used");
  });
});
