import type { Tenant } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Resolução de tenant com cache em memória.
 *
 * Tenants mudam raramente, então um cache simples com TTL de 60s evita uma
 * query por request. O cache é por processo — em ambiente multi-instância cada
 * instância tem o seu, o que é aceitável (consistência eventual de 60s).
 */
const CACHE_TTL_MS = 60_000;

type CacheEntry = { tenant: Tenant | null; expiresAt: number };

const bySlug = new Map<string, CacheEntry>();
const byDomain = new Map<string, CacheEntry>();
const byId = new Map<string, CacheEntry>();

function readCache(cache: Map<string, CacheEntry>, key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry;
}

function cacheTenant(tenant: Tenant): void {
  const expiresAt = Date.now() + CACHE_TTL_MS;
  bySlug.set(tenant.slug, { tenant, expiresAt });
  byId.set(tenant.id, { tenant, expiresAt });
  if (tenant.domain) {
    byDomain.set(tenant.domain, { tenant, expiresAt });
  }
}

export async function resolveTenantBySlug(slug: string): Promise<Tenant | null> {
  const cached = readCache(bySlug, slug);
  if (cached) return cached.tenant;

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (tenant) {
    cacheTenant(tenant);
  } else {
    bySlug.set(slug, { tenant: null, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return tenant;
}

export async function resolveTenantByDomain(domain: string): Promise<Tenant | null> {
  const cached = readCache(byDomain, domain);
  if (cached) return cached.tenant;

  const tenant = await prisma.tenant.findUnique({ where: { domain } });
  if (tenant) {
    cacheTenant(tenant);
  } else {
    byDomain.set(domain, { tenant: null, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return tenant;
}

export async function resolveTenantById(id: string): Promise<Tenant | null> {
  const cached = readCache(byId, id);
  if (cached) return cached.tenant;

  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (tenant) {
    cacheTenant(tenant);
  } else {
    byId.set(id, { tenant: null, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return tenant;
}

/** Limpa todos os caches de tenant. Uso: testes. */
export function _resetTenantCache(): void {
  bySlug.clear();
  byDomain.clear();
  byId.clear();
}
