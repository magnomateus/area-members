# Plataforma de Membros VIS

Área de membros **multi-tenant** integrada à VIS Platform (gateway de checkout).
Automatiza o fluxo pós-compra: do pagamento aprovado ao cliente consumindo o
produto, sem intervenção manual.

> **Status:** Fase 1 · sub-fase 1.1 (bootstrap do projeto e schema). Sem
> features de usuário ainda — ver [docs/PHASES.md](./docs/PHASES.md).

## Pré-requisitos

- **Node.js** 20 LTS ou superior
- **pnpm** (package manager do projeto)
- Acesso a um banco **PostgreSQL** — em dev e em prod usamos **Supabase**
  (este projeto **não usa Docker** — ver `docs/ARCHITECTURE.md` seção 3)

## Setup

```bash
# 1. Variáveis de ambiente
cp .env.example .env
# Preencha DATABASE_URL (pooler, porta 6543) e DIRECT_URL (direta, porta 5432)
# com as credenciais do seu projeto Supabase.

# 2. Instalar dependências
pnpm install

# 3. Aplicar o schema no banco (migrations) + gerar o Prisma Client
pnpm db:migrate

# 4. Popular dados de desenvolvimento (tenant Missa Explicada + dados fake)
pnpm db:seed

# 5. Subir o servidor de desenvolvimento
pnpm dev
```

App em http://localhost:3000 · Prisma Studio com `pnpm db:studio`.

> **Banco — Supabase.** `DATABASE_URL` aponta para o **pooler** (porta 6543,
> usado pelo Prisma Client em runtime) e `DIRECT_URL` para a **conexão direta**
> (porta 5432, usada pelo Prisma Migrate). Ambos são obrigatórios. Se a senha
> tiver caracteres especiais (`@`, `:`, `/`), use percent-encoding na URL.

## Comandos

| Comando           | O que faz                                            |
| ----------------- | ---------------------------------------------------- |
| `pnpm dev`        | Servidor de desenvolvimento Next.js                  |
| `pnpm build`      | Build de produção                                    |
| `pnpm start`      | Sobe o build de produção                             |
| `pnpm lint`       | ESLint                                               |
| `pnpm format`     | Formata o código com Prettier                        |
| `pnpm typecheck`  | Checagem de tipos (`tsc --noEmit`)                   |
| `pnpm db:migrate` | Cria/aplica migrations em dev (`prisma migrate dev`) |
| `pnpm db:seed`    | Roda o seed de desenvolvimento                       |
| `pnpm db:studio`  | Abre o Prisma Studio                                 |
| `pnpm db:reset`   | Reseta o banco e reaplica migrations + seed          |

## Estrutura

```
prisma/        Schema, migrations e seed
src/
  app/         Rotas (App Router) — (public), (member), (admin), api/
  lib/         Lógica de domínio (auth, tenant, webhooks, entitlements, ...)
  components/  UI (member / admin)
  types/       Tipos compartilhados
public/        Assets estáticos
tests/         unit / integration / e2e
docs/          Documentação de fundação
```

Detalhe completo em [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) seção 12.

## Documentação

A pasta [docs/](./docs/) contém os documentos de fundação — **fonte da verdade**
do projeto:

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — constituição: stack, modelo de dados, fluxos, regras
- [WEBHOOK_CONTRACT.md](./docs/WEBHOOK_CONTRACT.md) — contrato de integração com a VIS Platform
- [PHASES.md](./docs/PHASES.md) — roadmap de fases e critérios de aceite

## Stack

Next.js 16 (App Router) · TypeScript strict · Prisma + PostgreSQL · Lucia Auth v3 ·
Tailwind CSS · pnpm. Justificativas em `docs/ARCHITECTURE.md` seção 3.
