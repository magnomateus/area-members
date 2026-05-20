import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { withTenantContext } from "@/lib/tenant/context";
import { TenantScopeError } from "@/lib/tenant/scoped-db";
import { RollbackSignal, scopedTestDb, testPrisma } from "../helpers/db";

/**
 * Teste CRÍTICO de isolamento multi-tenant.
 *
 * Cria tenants/users dentro de uma transação revertida ao final e verifica que
 * o `scoped-db` nunca deixa um tenant enxergar dados de outro.
 */
afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("isolamento entre tenants (scoped-db)", () => {
  it("um tenant nunca enxerga User de outro tenant", async () => {
    try {
      await scopedTestDb.$transaction(async (tx) => {
        const tenantA = await tx.tenant.create({
          data: { slug: `tA-${randomUUID()}`, name: "Tenant A", branding: {} },
        });
        const tenantB = await tx.tenant.create({
          data: { slug: `tB-${randomUUID()}`, name: "Tenant B", branding: {} },
        });

        const userA = await withTenantContext(tenantA.id, () =>
          tx.user.create({
            data: { tenantId: tenantA.id, email: `a-${randomUUID()}@test.local` },
          }),
        );
        const userB = await withTenantContext(tenantB.id, () =>
          tx.user.create({
            data: { tenantId: tenantB.id, email: `b-${randomUUID()}@test.local` },
          }),
        );

        // Tenant A só enxerga o próprio User.
        const seenByA = await withTenantContext(tenantA.id, () => tx.user.findMany());
        expect(seenByA.map((u) => u.id)).toEqual([userA.id]);

        // Tenant B só enxerga o próprio User.
        const seenByB = await withTenantContext(tenantB.id, () => tx.user.findMany());
        expect(seenByB.map((u) => u.id)).toEqual([userB.id]);

        // Tenant A não acessa o User de B nem buscando pelo id explícito.
        const crossAccess = await withTenantContext(tenantA.id, () =>
          tx.user.findFirst({ where: { id: userB.id } }),
        );
        expect(crossAccess).toBeNull();

        throw new RollbackSignal();
      });
    } catch (error) {
      if (!(error instanceof RollbackSignal)) throw error;
    }
  });

  it("bloqueia findUnique em modelo tenant-scoped", async () => {
    try {
      await scopedTestDb.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { slug: `tC-${randomUUID()}`, name: "Tenant C", branding: {} },
        });
        await withTenantContext(tenant.id, async () => {
          await expect(tx.user.findUnique({ where: { id: randomUUID() } })).rejects.toBeInstanceOf(
            TenantScopeError,
          );
        });
        throw new RollbackSignal();
      });
    } catch (error) {
      if (!(error instanceof RollbackSignal)) throw error;
    }
  });

  it("rejeita create de User com tenantId divergente do contexto", async () => {
    try {
      await scopedTestDb.$transaction(async (tx) => {
        const tenantA = await tx.tenant.create({
          data: { slug: `tD-${randomUUID()}`, name: "Tenant D", branding: {} },
        });
        const tenantB = await tx.tenant.create({
          data: { slug: `tE-${randomUUID()}`, name: "Tenant E", branding: {} },
        });
        await withTenantContext(tenantA.id, async () => {
          await expect(
            tx.user.create({
              data: { tenantId: tenantB.id, email: `x-${randomUUID()}@test.local` },
            }),
          ).rejects.toBeInstanceOf(TenantScopeError);
        });
        throw new RollbackSignal();
      });
    } catch (error) {
      if (!(error instanceof RollbackSignal)) throw error;
    }
  });
});
