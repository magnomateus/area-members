import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import type { Tenant } from "@prisma/client";
import { resolveTenantById } from "@/lib/tenant/resolver";

/**
 * Contexto de tenant.
 *
 * - Dentro de uma request: o proxy injeta o header `X-Tenant-Id`. Server
 *   Components e Route Handlers leem dele via `next/headers`.
 * - Fora de request (seed, testes, scripts): `withTenantContext()` propaga o
 *   `tenantId` por `AsyncLocalStorage`.
 *
 * `getCurrentTenantId()` lê o ALS primeiro e cai para o header.
 * Ver ARCHITECTURE.md seção 9.
 */
export const TENANT_HEADER = "x-tenant-id";

type TenantStore = { tenantId: string };

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Executa `fn` com `tenantId` disponível no contexto. Para código fora de request.
 *
 * O callback faz `await fn()` DENTRO do escopo do `AsyncLocalStorage` — sem isso,
 * uma PrismaPromise lazy retornada por `fn` só seria executada depois, fora do
 * contexto, e `getCurrentTenantId()` veria `null`.
 */
export function withTenantContext<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ tenantId }, async () => {
    const result = await fn();
    return result;
  });
}

/** `tenantId` do contexto atual, ou `null` se não houver. */
export async function getCurrentTenantId(): Promise<string | null> {
  const fromStore = storage.getStore();
  if (fromStore) return fromStore.tenantId;

  try {
    const requestHeaders = await headers();
    return requestHeaders.get(TENANT_HEADER);
  } catch {
    // `headers()` lança fora do escopo de request; sem ALS, não há tenant.
    return null;
  }
}

/** Tenant completo do contexto atual. Lança se não houver tenant resolvível. */
export async function requireTenant(): Promise<Tenant> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) {
    throw new Error(
      "Nenhum tenant no contexto atual (sem header X-Tenant-Id e sem AsyncLocalStorage).",
    );
  }
  const tenant = await resolveTenantById(tenantId);
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} não encontrado.`);
  }
  return tenant;
}
