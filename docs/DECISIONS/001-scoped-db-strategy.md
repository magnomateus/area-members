# ADR 001 — Estratégia do `scoped-db`

- **Status:** Aceito
- **Data:** Maio/2026
- **Contexto da decisão:** Sub-fase 1.2 (proxy multi-tenant + auth base)
- **Referência:** `ARCHITECTURE.md` v1.2, seção 9

## Contexto

O isolamento entre tenants é regra absoluta (`ARCHITECTURE.md` seção 2, regra 5;
seção 9). Toda query em tabela tenant-scoped precisa do `tenantId`. Fazer isso
manualmente em cada query é frágil — basta um esquecimento para vazar dados de
um tenant para outro.

Precisamos de um mecanismo que aplique o `tenantId` automaticamente, sem permitir
que o desenvolvedor o esqueça.

## Decisão

`src/lib/tenant/scoped-db.ts` é uma **Prisma Client Extension** que intercepta
todas as operações e aplica o `tenantId` do contexto atual
(`getCurrentTenantId()`), com regras híbridas por operação — porque nem toda
operação aceita um filtro arbitrário de `tenantId`.

### Modelos tenant-scoped

`User`, `Offer`, `Product`, `Order` — têm coluna `tenantId` própria.

### Regras por operação (nos modelos tenant-scoped)

| Grupo | Operações | Comportamento |
|-------|-----------|---------------|
| Auto-inject no `where` | `findMany`, `findFirst`, `findFirstOrThrow`, `update`, `updateMany`, `delete`, `deleteMany`, `count`, `aggregate`, `groupBy` | Mescla `where: { tenantId }` automaticamente. Exige contexto de tenant ativo. |
| Bloqueado | `findUnique`, `findUniqueOrThrow` | Lança `TenantScopeError`. `findUnique` só aceita campos únicos no `where` — não dá para adicionar `tenantId`. Usar `findFirst`. |
| Validado (não injetado) | `create`, `createMany`, `upsert` | Exige `tenantId` presente no `data`. Havendo contexto de tenant ativo, o `tenantId` do `data` deve bater com ele — senão lança `TenantScopeError`. |

### Modelos NÃO tenant-scoped

`Session`, `AccessToken`, `WebhookDelivery`, `PushSubscription` e os modelos
filhos sem `tenantId` (`OfferProduct`, `OrderItem`, `ContentItem`, `Entitlement`,
`Progress`) — passam direto, sem alteração. O isolamento desses é transitivo,
via o pai (ex.: `ContentItem` → `Product.tenantId`).

### Caso especial: `EventLog`

`EventLog.tenantId` é opcional (eventos globais de sistema existem). Regra:
- `create` / `createMany`: se `tenantId` estiver no `data`, é validado contra o
  contexto; se ausente, é permitido.
- demais operações: passam direto.

## Consequências

**Positivas**
- Esquecer o `tenantId` numa leitura tenant-scoped é impossível — a extension
  injeta ou lança erro.
- `create` com `tenantId` de outro tenant é barrado em runtime.

**Negativas / trade-offs**
- `findUnique` é proibido em modelos tenant-scoped via `scopedDb`; o código usa
  `findFirst`. Lookups por id viram `findFirst({ where: { id } })`.
- A extension depende de `getCurrentTenantId()`. Fora de request, o contexto
  precisa ser estabelecido com `withTenantContext()` (seed, testes, scripts).
- O Lucia Auth usa o client base (`prisma`), não o `scopedDb` — suas queries em
  `User`/`Session` são por id de sessão e não passam pela extension.

## Como usar

- **Leitura/escrita de dados de negócio dentro de um tenant:** sempre `scopedDb`.
- **Operações de infra de auth (Lucia, AccessToken, Session):** client base `prisma`.
- **Fora de request:** envolver em `withTenantContext(tenantId, () => ...)`.
