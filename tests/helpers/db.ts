import { type Prisma, PrismaClient } from "@prisma/client";
import { createScopedDb } from "@/lib/tenant/scoped-db";

/**
 * Infra de banco para os testes.
 *
 * Usa a conexão DIRETA (`DIRECT_URL`, porta 5432): transações interativas — base
 * do rollback por teste — não funcionam de forma confiável pelo pooler/pgbouncer
 * (6543). Cada teste roda dentro de uma transação revertida ao final, então nada
 * é persistido (o seed e dados reais ficam intactos).
 */
const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  throw new Error("DIRECT_URL ausente — necessário para os testes (ver .env / .env.example).");
}

export const testPrisma = new PrismaClient({ datasourceUrl: directUrl });
export const scopedTestDb = createScopedDb(testPrisma);

/** Sinal interno usado para forçar o rollback da transação de teste. */
export class RollbackSignal extends Error {
  constructor() {
    super("rollback de teste");
    this.name = "RollbackSignal";
  }
}

/**
 * Roda `fn` numa transação interativa (client cru) e SEMPRE faz rollback ao
 * final. Erros e asserts de dentro de `fn` propagam normalmente.
 */
export async function rollbackRaw(
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await testPrisma.$transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}
