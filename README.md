# Plataforma de Membros VIS

Área de membros **multi-tenant** integrada à VIS Platform (gateway de checkout).
Automatiza o fluxo pós-compra: do pagamento aprovado ao cliente consumindo o
produto, sem intervenção manual.

> **Status:** Fase 1 · sub-fase 1.5 (página do produto + download de PDF via
> signed URL) — ver [docs/PHASES.md](./docs/PHASES.md).

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

# Simular order.approved → PROVISIONA (User + Order + Entitlements + AccessToken)
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

### Fluxo de provisionamento (order.approved → acesso)

Um `order.approved` provisiona tudo numa transação atômica: `User`, `Order`,
`OrderItems`, `Entitlements` (1 por Product liberado, com `expiresAt` conforme
`OfferProduct.validityDays`) e um `AccessToken`. O **AccessToken nunca aparece
na resposta do webhook** — chega ao cliente pelo polling ou (na 1.6) por
WhatsApp/email. Em dev, o magic link é impresso no console como
`[NOTIFICATION STUB] ...`.

```bash
# 1) Provisiona (o preset 'approved' usa o produto DEV → libera 3 produtos)
curl -X POST http://localhost:3000/api/webhooks/vis/simulate \
  -H "content-type: application/json" -d '{"preset":"approved"}'
# → { "action": "provisioned", "entitlementsCreated": 3, "orderId": "...", ... }

# 2) Polling — a página /obrigado (sub-fase 1.4) consumirá este endpoint
curl "http://localhost:3000/api/orders/status?order_id=778001&email=simulado@dev.local"
# → { "status": "ready", "accessToken": "<uuid>", "redirectUrl": "/auth/redeem?t=<uuid>" }
```

`GET /api/orders/status` responde **sempre 200** (anti-enumeração): `pending`
enquanto não provisionado ou se o email não confere, `ready` com o token quando
pronto, `failed` se a Order foi recusada/cancelada/chargeback.

Cada webhook recebido vira um registro em `WebhookDelivery` e em `EventLog`
(visíveis no `pnpm db:studio`).

### Fluxo pós-compra no navegador (telas da 1.4)

Depois de provisionar (passo acima), abra o fluxo no navegador — de preferência
em modo mobile (largura ~375px):

1. **`/obrigado?order_id=<id>&email=<email>`** — tela de polling: loader,
   subtexto rotativo e barra de progresso (a barra é **puramente visual**). Ao
   detectar `ready`, redireciona sozinha para `/auth/redeem`.
2. **`/auth/redeem?t=<token>`** — Route Handler: consome o `AccessToken`, cria
   a sessão e redireciona para `/home?first=1`. Link inválido/expirado/usado →
   volta para `/login?reason=…` (a página mostra um aviso).
3. **`/home?first=1`** — área de membros: modal full-screen de boas-vindas no
   primeiro acesso + lista dos produtos liberados. "Sair" encerra a sessão.

O `order_id` é o `visOrderId` da VIS (o número que você passou no payload), não
o `orderId` UUID retornado pelo simulador.

### Página do produto e download de PDF (telas da 1.5)

Depois de logado (passo 3 acima), a home lista os produtos liberados. Clicar em
**"Acessar"** abre `/produtos/[slug]` — a página do produto, com a lista de
ConteúdoItems ativos. Para um item PDF, o botão **"Baixar PDF"**:

1. chama `GET /api/content/[id]/signed-url` (autenticado);
2. o endpoint valida sessão + Entitlement ativo e gera uma **signed URL** do
   Supabase Storage **válida por 15 min** (proteção contra compartilhamento);
3. o navegador abre o PDF numa nova aba (em mobile, no leitor nativo).

O endpoint responde `{ error: { code, message } }` nos casos de erro:
`UNAUTHENTICATED` (401), `FORBIDDEN_NO_ACCESS` (403), `CONTENT_NOT_FOUND` (404),
`RATE_LIMITED` (429, limite de 10/min por usuário), `INVALID_CONTENT_TYPE`
(400) e `INTERNAL_ERROR` (500).

O Supabase Storage exige `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e
`STORAGE_BUCKET` no `.env` (ver `.env.example`). O `@supabase/supabase-js` é
usado **apenas** para Storage e fica encapsulado em `src/lib/storage/` —
ver [docs/DECISIONS/002-supabase-js-storage-only.md](./docs/DECISIONS/002-supabase-js-storage-only.md).

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
