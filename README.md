# Plataforma de Membros VIS

Área de membros **multi-tenant** integrada à VIS Platform (gateway de checkout).
Automatiza o fluxo pós-compra: do pagamento aprovado ao cliente consumindo o
produto, sem intervenção manual.

> **Status:** Fase 1 · sub-fase 1.2 (proxy multi-tenant + autenticação
> base). Ainda sem páginas de produto/home — ver [docs/PHASES.md](./docs/PHASES.md).

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

## Desenvolvimento

### Resolução de tenant em dev

O proxy (`src/proxy.ts`) resolve o tenant pela variável **`DEV_TENANT_SLUG`** (em produção a
resolução é pelo hostname → `Tenant.domain`). O `.env.example` já traz
`DEV_TENANT_SLUG=missa-explicada`. Um slug inexistente faz toda request
responder **404 — Tenant não encontrado**.

### Testar o login por magic link

A Fase 1 tem apenas login por **magic link** (sem senha). O envio real por
WhatsApp/email só chega na sub-fase 1.6 — por enquanto o link é **impresso no
console do servidor**:

1. `pnpm dev` e abra http://localhost:3000/login
2. Informe o email do usuário de seed: `magno@dev.local`
3. A página mostra sempre uma mensagem genérica (anti-enumeração — não
   confirma nem nega se o email existe)
4. No terminal do `pnpm dev` aparece:
   `[magic-link] magno@dev.local -> http://localhost:3000/auth/redeem?t=<token>`
5. O `AccessToken` gerado fica visível no `pnpm db:studio`

A página `/auth/redeem`, que consome o token e cria a sessão, chega na
sub-fase 1.4.

### Testar webhooks da VIS localmente

O endpoint `POST /api/webhooks/vis` recebe os webhooks da VIS (valida HMAC-V1,
idempotência, roteia por evento). Para testar sem a VIS real, use o **simulador**
— habilite-o subindo o dev com a flag:

```bash
ENABLE_WEBHOOK_SIMULATOR=true pnpm dev
```

```bash
# Simular um webhook.test (não provisiona nada; só valida e loga)
curl -X POST http://localhost:3000/api/webhooks/vis/simulate \
  -H "content-type: application/json" -d '{"preset":"webhook.test"}'

# Simular order.approved (na 1.3a: apenas loga — provisionamento vem na 1.3b)
curl -X POST http://localhost:3000/api/webhooks/vis/simulate \
  -H "content-type: application/json" -d '{"preset":"approved"}'

# Idempotência: enviar o MESMO payload 2x — a 2ª resposta traz "duplicate": true
curl -X POST http://localhost:3000/api/webhooks/vis/simulate \
  -H "content-type: application/json" \
  -d '{"payload":{"event":"order.approved","data":{"order_id":4242,"products":[{"id":99999}],"tracking":{"src":"tenant_missa-explicada"}}}}'
```

Presets disponíveis: `approved`, `refunded`, `cancelled`, `chargedback`,
`webhook.test`. Aceita também `{ "payload": <payload completo> }` e
`{ "preset": "...", "overrides": {...} }`. O simulador **não valida HMAC** e
responde **404** em produção ou sem `ENABLE_WEBHOOK_SIMULATOR=true`.

Cada webhook recebido vira um registro em `WebhookDelivery` e em `EventLog`
(visíveis no `pnpm db:studio`). O provisionamento (User/Order/Entitlements) é
da sub-fase 1.3b — a 1.3a só recebe, valida e loga.

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
