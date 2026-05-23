# ADR 005 — Banco MySQL no Titan (substitui Postgres/Supabase)

- **Status:** Aceito
- **Data:** 23/05/2026
- **Contexto da decisão:** Fase 1 da migração Vercel/Supabase → Titan/MySQL
- **Referência:** `ARCHITECTURE.md` v1.6, seções 3 (stack) e 5 (modelo de dados)

## Contexto

A VIS Platform roda no droplet **Titan** (Digital Ocean) com MySQL 8.0
provisionado. A `vis-membros` estava em **Postgres via Supabase** (projeto
separado), o que duplicava infra (dois bancos, dois fornecedores de backup),
operações (dois consoles, dois conjuntos de credenciais) e custos.

A Fase 5 (Admin Dashboard) começou em MVP — agora, antes de produção real, é
o momento certo para consolidar a infra antes que migração futura fique cara.

## Decisão

A `vis-membros` migra para **MySQL 8 no Titan**, em um banco `vis_membros`
isolado (mesma instância da VIS Platform, mas DB separado).

- **Dev local:** MySQL via Scoop no Windows, banco `vis_membros_dev`, usuário
  separado (`vismembros_dev@localhost`).
- **Prod (Titan):** MySQL 8.0, banco `vis_membros`, usuário `vismembros_user`
  com privilégios escopados ao banco.

## Alternativas consideradas

- **Manter Supabase Postgres**: dupla infra. Supabase é Postgres gerenciado de
  qualidade, mas o custo operacional de manter dois bancos não se justifica
  agora que a VIS Platform e a `vis-membros` formam um produto unificado.
- **Droplet próprio com Postgres**: complexidade similar à atual (sem ganho).
- **Postgres no Titan**: subir um Postgres ao lado do MySQL existente seria
  ortogonal ao stack da VIS — sem ganho operacional.

## Trade-offs

**Pros**
- **Unificação operacional** com a VIS Platform (backup, monitoramento, SSH).
- **Custo zero adicional** (droplet já provisionado).
- **Isolamento de dados** via banco separado (`vis_membros` distinto dos bancos
  da VIS — usuários e privilégios independentes).
- **Performance**: queries locais (mesmo host do app).

**Cons / adaptações**
- **Schema Prisma adaptado**: `provider = "mysql"` e `directUrl` removido (o
  split pooler/direct era um workaround do pgbouncer do Supabase; MySQL não
  precisa).
- **Sintaxe JSON path do Prisma muda**: Postgres usa `path: ["x"]` (array);
  MySQL usa `path: "$.x"` (JSONPath). Afetou um arquivo:
  `tests/integration/admin/auth-flow.test.ts`.
- **Features Postgres-only** (GIN/GIST, arrays escalares de tipo) **não estavam
  em uso** — o schema é portável sem reescrita.

## Implementação

- **`prisma/schema.prisma`**:
  ```prisma
  datasource db {
    provider = "mysql"
    url      = env("DATABASE_URL")
  }
  ```
- **Migrations Postgres antigas removidas** (backup local em
  `prisma/migrations.backup-postgres/`, gitignored). Nova migration única
  `20260523155705_init_mysql` gerada via `prisma migrate dev` contra MySQL
  local.
- **`tests/helpers/db.ts`**: usa `DATABASE_URL` direto.
- **`.env.example`**: `DATABASE_URL="mysql://user:password@localhost:3306/db"`.

## Consequências operacionais

- **Dev local exige MySQL instalado** (Scoop no Windows: `scoop install mysql`).
  Instruções no `README.md`.
- **Shadow database** do Prisma: o `prisma migrate dev` precisa de privilégios
  `CREATE/DROP` globais para criar a shadow DB. **Em dev** o user tem
  `GRANT ALL ON *.*`; **em prod** o user tem `GRANT ALL ON vis_membros.*`
  apenas (sem shadow DB) — e usa `prisma migrate deploy` (não `migrate dev`),
  que não cria shadow.
- **Disaster recovery**: backup do MySQL Titan entra no plano de backup do
  droplet, compartilhado com a VIS Platform. Estratégia detalhada em
  `RUNBOOK.md` (a preencher nas Fases 4-7).
- **Versão**: dev usa MySQL 9.7 (única versão no `main` bucket do Scoop), prod
  usa 8.0 no Titan. O SQL gerado pelo Prisma para este schema é portável
  entre as duas (sem features MySQL 9-only).
