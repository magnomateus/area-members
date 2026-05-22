import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminMagicLinkExpiredError,
  AdminMagicLinkNotFoundError,
  AdminMagicLinkUsedError,
  createAdminMagicLink,
  validateAdminMagicLink,
} from "@/lib/admin/magic-link";
import { testPrisma } from "../../helpers/db";

/**
 * Testes do magic link do admin. Cria um AdminUser comitado no beforeAll
 * (as funções usam o `prisma` global) e limpa no afterAll.
 */
let adminUserId = "";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Insere um AdminMagicLink cru (para exercitar estados expirado/usado). */
async function seedLink(opts: { token: string; expiresAt: Date; usedAt?: Date }): Promise<void> {
  await testPrisma.adminMagicLink.create({
    data: {
      adminUserId,
      tokenHash: hashToken(opts.token),
      expiresAt: opts.expiresAt,
      usedAt: opts.usedAt,
    },
  });
}

beforeAll(async () => {
  const admin = await testPrisma.adminUser.create({
    data: { email: `ml-${randomUUID()}@test.local`, name: "ML Test", role: "ADMIN" },
  });
  adminUserId = admin.id;
});

afterAll(async () => {
  await testPrisma.adminMagicLink.deleteMany({ where: { adminUserId } });
  await testPrisma.adminUser.delete({ where: { id: adminUserId } });
  await testPrisma.$disconnect();
});

describe("createAdminMagicLink", () => {
  it("gera token hex, grava só o hash SHA-256 e expira em ~15min", async () => {
    const before = Date.now();
    const { token, expiresAt } = await createAdminMagicLink(adminUserId);

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(before + 14 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThan(before + 16 * 60 * 1000);

    // No banco está o hash — nunca o token bruto.
    const byHash = await testPrisma.adminMagicLink.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    expect(byHash).not.toBeNull();
    const byRawToken = await testPrisma.adminMagicLink.findFirst({
      where: { tokenHash: token },
    });
    expect(byRawToken).toBeNull();
  });
});

describe("validateAdminMagicLink", () => {
  it("token válido → devolve o adminUserId", async () => {
    const { token } = await createAdminMagicLink(adminUserId);
    const result = await validateAdminMagicLink(token);
    expect(result.adminUserId).toBe(adminUserId);
  });

  it("token expirado → AdminMagicLinkExpiredError (com adminUserId)", async () => {
    const token = randomUUID();
    await seedLink({ token, expiresAt: new Date(Date.now() - 1000) });
    await expect(validateAdminMagicLink(token)).rejects.toBeInstanceOf(AdminMagicLinkExpiredError);
  });

  it("token já usado → AdminMagicLinkUsedError", async () => {
    const token = randomUUID();
    await seedLink({ token, expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() });
    await expect(validateAdminMagicLink(token)).rejects.toBeInstanceOf(AdminMagicLinkUsedError);
  });

  it("token inexistente (hash não bate) → AdminMagicLinkNotFoundError", async () => {
    await expect(validateAdminMagicLink(randomUUID())).rejects.toBeInstanceOf(
      AdminMagicLinkNotFoundError,
    );
  });

  it("queima atômica: marca usedAt e rejeita a 2ª validação", async () => {
    const { token } = await createAdminMagicLink(adminUserId);
    await validateAdminMagicLink(token);

    const row = await testPrisma.adminMagicLink.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    expect(row?.usedAt).not.toBeNull();

    await expect(validateAdminMagicLink(token)).rejects.toBeInstanceOf(AdminMagicLinkUsedError);
  });
});
