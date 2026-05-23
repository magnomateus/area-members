# Plataforma de Membros VIS

Área de membros **multi-tenant** integrada à VIS Platform (gateway de checkout).
Automatiza o fluxo pós-compra: do pagamento aprovado ao cliente consumindo o
produto, sem intervenção manual.

> **Status:** Fase 1 · sub-fase 1.5 (página do produto + download de PDF via
> signed URL) — ver [docs/PHASES.md](./docs/PHASES.md).

## Pré-requisitos

- **Node.js** 20 LTS ou superior
- **pnpm** (package manager do projeto)
- **MySQL 8+** local — dev em Windows via Scoop (`scoop install mysql`); em prod
  roda no droplet **Titan** junto da VIS Platform (banco `vis_membros` isolado).
  Ver [ADR 005](./docs/DECISIONS/005-banco-mysql-titan.md).
- Este projeto **não usa Docker** — ver `docs/ARCHITECTURE.md` seção 3.

## Setup

```bash
# 1. Subir um MySQL local (Windows / Scoop)
scoop install mysql                              # baixa e instala o MySQL 9.7+
mysqld --console                                 # inicia o daemon (ou registra como serviço)
mysql -uroot -e "CREATE DATABASE vis_membros_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -uroot -e "CREATE USER 'vismembros_dev'@'localhost' IDENTIFIED BY 'CHANGE_ME';"
mysql -uroot -e "GRANT ALL PRIVILEGES ON *.* TO 'vismembros_dev'@'localhost'; FLUSH PRIVILEGES;"
# (Prisma migrate dev precisa de privilégios globais para a shadow DB.)

# 2. Variáveis de ambiente
cp .env.example .env
# Preencha DATABASE_URL apontando para o MySQL local:
#   DATABASE_URL="mysql://vismembros_dev:CHANGE_ME@localhost:3306/vis_membros_dev"
# E gere o STORAGE_SIGN_SECRET:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 3. Instalar dependências
pnpm install

# 4. Aplicar o schema no banco (migrations) + gerar o Prisma Client
pnpm db:migrate

# 5. Popular dados de desenvolvimento (tenant Missa Explicada + dados fake)
pnpm db:seed

# 6. Subir o servidor de desenvolvimento
pnpm dev
```

App em http://localhost:3000 · Prisma Studio com `pnpm db:studio`.

> **Banco — MySQL.** Em dev, qualquer MySQL 8+ local serve. Se a senha do user
> tiver caracteres especiais (`@`, `:`, `/`), use percent-encoding na URL.
> Em prod (Titan), o user `vismembros_user` tem `GRANT ALL ON vis_membros.*`
> apenas — deploy usa `prisma migrate deploy` (sem shadow DB).

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
2. o endpoint valida sessão + Entitlement ativo e gera uma **signed URL HMAC**
   apontando para `/api/files/<token>`, **válida por 15 min** (proteção contra
   compartilhamento);
3. o navegador abre o PDF numa nova aba (em mobile, no leitor nativo).

O endpoint responde `{ error: { code, message } }` nos casos de erro:
`UNAUTHENTICATED` (401), `FORBIDDEN_NO_ACCESS` (403), `CONTENT_NOT_FOUND` (404),
`RATE_LIMITED` (429, limite de 10/min por usuário), `INVALID_CONTENT_TYPE`
(400) e `INTERNAL_ERROR` (500).

O storage é o **filesystem local** (`STORAGE_PATH=./storage/files` em dev;
`/var/data/vis-membros/files` em prod). As signed URLs são assinadas com
HMAC-SHA256 nativo (`STORAGE_SIGN_SECRET`), e `GET /api/files/[token]`
responde **404 silente** (anti-enumeração) para qualquer falha. Ver
[docs/DECISIONS/004-storage-filesystem-local.md](./docs/DECISIONS/004-storage-filesystem-local.md).

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

Next.js 16 (App Router) · TypeScript strict · Prisma + **MySQL 8** (Titan) ·
Lucia Auth v3 · Tailwind CSS · shadcn/ui (admin) · pnpm. Deploy via **PM2 +
nginx** em `membros.visplatform.pro`. Justificativas em `docs/ARCHITECTURE.md`
seção 3.
