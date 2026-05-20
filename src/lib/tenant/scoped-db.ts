import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentTenantId } from "@/lib/tenant/context";

/**
 * scoped-db — Prisma Client Extension que aplica o `tenantId` do contexto atual.
 *
 * Estratégia híbrida por operação (ver docs/DECISIONS/001-scoped-db-strategy.md
 * e ARCHITECTURE.md seção 9):
 *
 * Modelos tenant-scoped (User, Offer, Product, Order):
 *  - WHERE auto-injetado: findMany, findFirst(OrThrow), update, updateMany,
 *    delete, deleteMany, count, aggregate, groupBy.
 *  - Bloqueado: findUnique(OrThrow) — não dá pra filtrar tenantId num lookup
 *    por chave única; use findFirst.
 *  - Validado (não injetado): create, createMany, upsert — exigem tenantId no
 *    data e ele deve bater com o contexto.
 *
 * EventLog: tenantId opcional — valida se presente, nunca injeta.
 * Demais modelos: passam direto.
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

const TENANT_SCOPED_MODELS = new Set<string>(["User", "Offer", "Product", "Order"]);

const WHERE_INJECT_OPERATIONS = new Set<string>([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

const BLOCKED_OPERATIONS = new Set<string>(["findUnique", "findUniqueOrThrow"]);

const CREATE_OPERATIONS = new Set<string>(["create", "createMany", "upsert"]);

type DataRow = Record<string, unknown>;

function extractCreateRows(operation: string, args: unknown): DataRow[] {
  const a = (args ?? {}) as { data?: DataRow | DataRow[]; create?: DataRow };
  if (operation === "upsert") {
    return a.create ? [a.create] : [];
  }
  if (Array.isArray(a.data)) return a.data;
  if (a.data) return [a.data];
  return [];
}

function assertCreateTenantId(
  model: string,
  operation: string,
  args: unknown,
  contextTenantId: string | null,
  required: boolean,
): void {
  for (const row of extractCreateRows(operation, args)) {
    const value = row.tenantId;
    if (value === undefined || value === null) {
      if (required) {
        throw new TenantScopeError(`'${operation}' em ${model} exige 'tenantId' no data.`);
      }
      continue;
    }
    if (typeof value !== "string") {
      throw new TenantScopeError(`'tenantId' inválido em '${operation}' de ${model}.`);
    }
    if (contextTenantId && value !== contextTenantId) {
      throw new TenantScopeError(
        `'tenantId' do data (${value}) diverge do tenant do contexto (${contextTenantId}) em ${model}.`,
      );
    }
  }
}

const tenantScopedExtension = Prisma.defineExtension({
  name: "tenant-scoped",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const isScoped = TENANT_SCOPED_MODELS.has(model);
        const isEventLog = model === "EventLog";

        if (!isScoped && !isEventLog) {
          return query(args);
        }

        const tenantId = await getCurrentTenantId();

        // EventLog: tenantId opcional — só valida, nunca injeta.
        if (isEventLog) {
          if (CREATE_OPERATIONS.has(operation)) {
            assertCreateTenantId(model, operation, args, tenantId, false);
          }
          return query(args);
        }

        // Modelos tenant-scoped.
        if (BLOCKED_OPERATIONS.has(operation)) {
          throw new TenantScopeError(
            `'${operation}' é proibido em modelo tenant-scoped (${model}). Use 'findFirst'.`,
          );
        }

        if (!tenantId) {
          throw new TenantScopeError(
            `'${operation}' em ${model} requer um tenant no contexto ` +
              `(header X-Tenant-Id via proxy ou withTenantContext).`,
          );
        }

        if (WHERE_INJECT_OPERATIONS.has(operation)) {
          const a = (args ?? {}) as { where?: Record<string, unknown> };
          const nextArgs = { ...a, where: { ...(a.where ?? {}), tenantId } };
          return query(nextArgs as Parameters<typeof query>[0]);
        }

        if (CREATE_OPERATIONS.has(operation)) {
          assertCreateTenantId(model, operation, args, tenantId, true);
        }

        return query(args);
      },
    },
  },
});

/** Cria um client Prisma com a extension de tenant-scoping aplicada. */
export function createScopedDb(client: PrismaClient) {
  return client.$extends(tenantScopedExtension);
}

/** Client Prisma tenant-scoped padrão, sobre o singleton global. */
export const scopedDb = createScopedDb(prisma);
