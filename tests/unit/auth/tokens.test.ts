import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenNotFoundError,
  generateAccessToken,
  redeemAccessToken,
} from "@/lib/auth/tokens";
import { rollbackRaw, testPrisma } from "../../helpers/db";

afterAll(async () => {
  await testPrisma.$disconnect();
});

/** Cria um User de teste sob o tenant de seed e devolve o id. */
async function createTestUser(tx: Prisma.TransactionClient): Promise<string> {
  const tenant = await tx.tenant.findFirstOrThrow({ where: { slug: "missa-explicada" } });
  const user = await tx.user.create({
    data: { tenantId: tenant.id, email: `tok-${randomUUID()}@test.local` },
  });
  return user.id;
}

describe("AccessToken — generate / redeem", () => {
  it("gera e resgata um token, retornando o User", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createTestUser(tx);
      const token = await generateAccessToken(userId, undefined, tx);
      const user = await redeemAccessToken(token, tx);
      expect(user.id).toBe(userId);
    });
  });

  it("marca o token como usado após o resgate", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createTestUser(tx);
      const token = await generateAccessToken(userId, undefined, tx);
      await redeemAccessToken(token, tx);
      const record = await tx.accessToken.findUnique({ where: { token } });
      expect(record?.usedAt).not.toBeNull();
    });
  });

  it("rejeita token inexistente", async () => {
    await rollbackRaw(async (tx) => {
      await expect(redeemAccessToken(randomUUID(), tx)).rejects.toBeInstanceOf(TokenNotFoundError);
    });
  });

  it("rejeita token expirado", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createTestUser(tx);
      const token = randomUUID();
      await tx.accessToken.create({
        data: { userId, token, expiresAt: new Date(Date.now() - 1_000) },
      });
      await expect(redeemAccessToken(token, tx)).rejects.toBeInstanceOf(TokenExpiredError);
    });
  });

  it("rejeita token já utilizado (uso duplo)", async () => {
    await rollbackRaw(async (tx) => {
      const userId = await createTestUser(tx);
      const token = await generateAccessToken(userId, undefined, tx);
      await redeemAccessToken(token, tx);
      await expect(redeemAccessToken(token, tx)).rejects.toBeInstanceOf(TokenAlreadyUsedError);
    });
  });
});
