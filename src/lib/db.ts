import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma singleton.
 *
 * Em desenvolvimento, o hot-reload do Next.js reavalia os modulos a cada
 * mudanca, o que criaria uma nova conexao a cada reload e esgotaria o pool
 * do Postgres. Guardar a instancia no escopo global evita isso.
 *
 * Esta sub-fase entrega apenas o singleton — sem queries de dominio ainda.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
