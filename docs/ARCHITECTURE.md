# ARCHITECTURE.md — Plataforma de Membros VIS

> **Documento de fundação do projeto.** Este é a "constituição" da Plataforma de Membros. Toda decisão técnica, todo prompt de Claude Code e toda discussão de feature DEVE referenciar este documento. Se algo aqui precisar mudar, a mudança é deliberada e documentada — não acidental.

> **Versão:** 1.2 • **Última atualização:** Maio/2026 • **Owner:** Magno Bessa

> **Changelog 1.2:** (a) Convenção de middleware migrada para `proxy.ts` (Next 16) — roda em **Node.js runtime** por padrão. (b) Estratégia híbrida do `scoped-db` documentada — seção 9. (c) Transporte de `tenantId`: header `X-Tenant-Id` dentro de request, `AsyncLocalStorage` fora de request — seção 9. (d) Renomeação `src/middleware.ts` → `src/proxy.ts` (função `middleware` → `proxy`).

> **Changelog 1.1:** (a) Adicionada restrição absoluta sem-Docker na seção 3. (b) `DIRECT_URL` adicionado às envs e ao `datasource db` do schema. (c) Campo `visWebhookSecret` adicionado ao modelo `Tenant`.

---

## 1. Objetivo do projeto

Construir uma **plataforma de área de membros multi-tenant** integrada à VIS Platform, com o objetivo primário de:

1. **Aumentar o LTV** dos clientes ao oferecer cross-sell e upsell contextual dentro da própria área de membros.
2. **Automatizar 100%** o fluxo pós-compra: do checkout aprovado até o cliente consumindo o produto, sem intervenção manual.
3. **Servir como hub de consumo** dos produtos digitais do Magno (Missa Explicada, Templo Revelado, futuros produtos católicos, Protocolo Alpha, etc).
4. **No médio prazo, virar feature da VIS Platform** — oferecida como diferencial competitivo a outros produtores que vendem pela VIS.

### Métrica-norte
**Tempo entre "pagamento aprovado" e "primeiro conteúdo consumido"** deve ser menor que 5 minutos para 80% dos clientes.

### Princípios de design não-negociáveis
- **Mobile-first.** O cliente principal é católico no celular. Desktop é secundário.
- **Zero fricção no acesso.** Cliente não digita senha pra entrar pela primeira vez.
- **Isolamento por tenant.** Dados de tenants diferentes nunca se cruzam, em hipótese alguma.
- **Cross-sell embutido na experiência.** Não é "extra", é parte da home do app.
- **Aditivo no contrato com a VIS.** Nunca depender de mudanças que quebrem outras integrações da VIS.

---

## 2. Modelo conceitual

### Conceitos fundamentais (decoradas estas distinções, o resto flui)

| Conceito | Definição | Exemplo |
|----------|-----------|---------|
| **Tenant** | Nicho/marca isolado. Tem branding, domínio, base de clientes própria. | "Missa Explicada", "Protocolo Alpha" |
| **Offer** | O que a VIS vende (produto na nomenclatura VIS). Tem preço, checkout, page de venda. | "Missa Explicada Premium R$67" |
| **Product** | O que o cliente CONSOME dentro da área de membros. | "Ebook Missa Explicada", "Comunidade WhatsApp", "App Premium" |
| **OfferProduct** | Junção: quais Products uma Offer libera. | Offer "Premium" libera Products: ebook + bônus + comunidade |
| **Entitlement** | Direito de acesso do User a um Product. É o que controla autorização. | User X tem entitlement ACTIVE ao Product Y, vindo da Order Z |
| **ContentItem** | Arquivos/links dentro de um Product. | Product "Ebook" tem ContentItems: PDF principal, áudio, link comunidade |
| **AccessToken** | Token single-use de 15min para login automático pós-compra. | UUID gerado no webhook, queimado no primeiro uso |

### Relações conceituais

```
Tenant 1───* Offer
Tenant 1───* Product
Tenant 1───* User

Offer *───* Product   (via OfferProduct)
Product 1───* ContentItem

User 1───* Order
Order *───* Product   (via OrderItem)
Order 1───* Entitlement   (cria, é sourceOrder)
User 1───* Entitlement
Product 1───* Entitlement

User 1───* Progress (consumo de ContentItems)
User 1───* AccessToken
User 1───* PushSubscription
```

### Regras de negócio críticas

1. **Email é único POR TENANT, não global.** `UNIQUE(tenantId, email)`. Mesma pessoa pode ser cliente de múltiplos tenants com mesmo email.
2. **Entitlements são imutáveis em termos de origem.** `sourceOrderId` nunca muda. Se cliente compra de novo o mesmo produto, é um NOVO entitlement.
3. **Validade do entitlement é definida no momento da concessão**, vinda do `OfferProduct.validityDays`. Default `null` = vitalício.
4. **Reembolso/chargeback → SUSPEND, nunca DELETE.** Dados preservados. Pode reativar.
5. **Multi-tenant isolation** é enforced em CADA query via proxy + `tenantId` em CADA tabela tenant-scoped. Sem exceções.

---

## 3. Stack técnica definitiva

| Camada | Tecnologia | Justificativa |
|--------|------------|---------------|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) | Mesmo stack do vis-dashboard. Curva zero. |
| Linguagem | TypeScript (strict mode) | Não-negociável. Type safety previne bugs em multi-tenant. |
| Banco | PostgreSQL via Supabase (projeto separado do vis-dashboard) | Já domina, RLS opcional, backup automático. |
| ORM | Prisma | Mesmo do vis-dashboard. Type-safe. |
| Auth | Lucia Auth v3 + JWT em cookie httpOnly | Controle total, sem amarras. |
| Storage | Supabase Storage com signed URLs (15min) | Proteção contra compartilhamento de links de PDF. |
| PWA | next-pwa + Workbox | Manifest dinâmico por tenant. Instalável no celular. |
| Push | Web Push API (VAPID) + biblioteca `web-push` | Funciona iOS 16.4+ e Android. |
| Email | Resend OU Microsoft Graph (Grupo 3RN) | Reaproveitar infra existente. |
| WhatsApp | Evolution API ou Z-API | Magno já tem familiaridade. |
| Observabilidade | Sentry + logs estruturados (pino) + EventLog interno | Tudo auditável. |
| Deploy | Vercel + Supabase | Mesma stack do vis-dashboard. |
| Testes | Vitest + Playwright (E2E críticos) | Webhook precisa de testes pesados. |

### Versionamento e dependências
- Node 20 LTS (mesma da Vercel default)
- Prisma 5.x
- Next 16.x
- Lucia 3.x
- Sem libs experimentais. Tudo estável.

### ❌ Restrição absoluta: SEM Docker

Este projeto NUNCA usa Docker — nem em dev, nem em prod. Não criar `docker-compose.yml`, não criar `Dockerfile`, não propor containers como solução pra nada.

**Por quê:**
- Máquina local de desenvolvimento (Magno) tem recurso limitado e não suporta Docker rodando confortavelmente
- Em produção, deploys vão direto no host (Vercel cuida do build do Next.js sem container; Supabase é Postgres gerenciado)
- Padrão do ecossistema do Magno: todos os projetos rodam diretamente no SO, sem orquestração de containers

**Alternativas a usar:**
- Postgres em dev: Supabase (recomendado) ou instalação nativa no host
- Postgres em prod: Supabase
- Build/deploy: Vercel (Next.js) ou DigitalOcean App Platform (se necessário no futuro)
- Serviços auxiliares: usar SaaS gerenciado (Resend, Evolution API SaaS, etc) em vez de self-host containerizado

---

## 4. Arquitetura de alto nível

### Fluxo principal: do checkout ao consumo

```
┌────────────────────────┐
│ Cliente em página      │
│ de vendas (qualquer)   │
└────────┬───────────────┘
         │ clica "comprar"
         ▼
┌────────────────────────┐
│ Checkout VIS Platform  │
│ ?src=tenant_xxxx       │
└────────┬───────────────┘
         │ pagamento aprovado
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐  ┌──────────────────────┐
│Redirect│  │ Webhook order.approved│
│síncrono│  │ (assíncrono, retry)   │
│        │  │                       │
│ /obri- │  │ 1. Valida HMAC-V1     │
│ gado   │  │ 2. Resolve tenant     │
│ ?order_│  │ 3. Upsert User        │
│ id=X   │  │ 4. Cria Order         │
│ ?email │  │ 5. Cria Entitlements  │
│ =Y     │  │ 6. Gera AccessToken   │
└───┬────┘  │ 7. Envia WA + email   │
    │       │ 8. Marca PROVISIONED  │
    │       └──────────────────────┘
    │
    │ polling a cada 2s
    ▼
┌────────────────────────────┐
│ GET /api/orders/status     │
│ retorna AccessToken quando │
│ webhook concluir           │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Redirect automático para   │
│ /auth/redeem?t={token}     │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Token validado, queimado,  │
│ sessão JWT criada          │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Home da área de membros    │
│ (PWA)                      │
│ - produtos liberados       │
│ - upsell na esteira        │
│ - prompt instalar PWA      │
│ - prompt habilitar push    │
└────────────────────────────┘
```

### Triplo fallback de entrega de acesso

A robustez vem do fato de **três caminhos independentes** levam o cliente ao app:

1. **Polling (primary):** página de obrigado faz polling, encontra token assim que webhook conclui, redireciona.
2. **WhatsApp (secondary):** cliente recebe link no WhatsApp em paralelo. Funciona mesmo se fechar o navegador.
3. **Email (tertiary):** mesmo link enviado por email como redundância final.

Se qualquer um desses três caminhos funcionar, o cliente acessa. Tem que falhar TODOS pra ele perder acesso (e mesmo aí, ele pode pedir reenvio do link a qualquer momento via "esqueci o acesso").

### Multi-tenancy

**Modelo:** Row-Level Isolation via `tenantId` em toda tabela tenant-scoped, com um proxy obrigatório que injeta `tenantId` no contexto da request.

**Resolução de tenant:**
1. **Por domínio (primary):** request chega em `app.missaexplicada.com.br` → proxy resolve tenant via `Tenant.domain`.
2. **Por `src` do tracking VIS (secondary, no webhook):** webhook chega → lê `data.tracking.src` (formato `tenant_<slug>`) → resolve tenant.
3. **Por mapeamento de Product VIS (fallback):** se `src` ausente, usa `Offer.visProductId` → lookup → tenant.

**Cliente nunca vê tenant cruzado.** Não tem endpoint global, não tem "global feed", nada.

### Camadas da aplicação

```
src/
├── app/                    # Next.js App Router (rotas)
├── lib/                    # lógica de domínio pura
│   ├── auth/              # sessão, tokens, lucia
│   ├── webhooks/          # validação + provisionamento
│   ├── entitlements/      # grant, revoke, check (autorização)
│   ├── notifications/     # whatsapp, email, push
│   ├── storage/           # signed URLs
│   └── tenant/            # resolução de tenant
├── components/             # UI (shadcn-style)
├── proxy.ts               # tenant detection + auth gate (convenção Next 16)
└── types/                 # tipos compartilhados
```

**Regra:** lógica de domínio fica em `lib/`, NUNCA em rotas. Rotas são finas, só orquestram.

---

## 5. Modelo de dados (Prisma)

Schema completo. Todo Claude Code prompt sobre banco deve referenciar este modelo.

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")     // pooler 6543 — runtime
  directUrl = env("DIRECT_URL")        // direct 5432 — migrations
}

// ─────────────────────────────────────────
// TENANT — nicho/marca isolado
// ─────────────────────────────────────────
model Tenant {
  id        String   @id @default(uuid())
  slug      String   @unique         // "missa-explicada", "protocolo-alpha"
  name      String                   // "Missa Explicada"
  domain    String?  @unique         // "app.missaexplicada.com.br"
  branding  Json                     // { logoUrl, primaryColor, appName, themeColor, ... }

  // Secret HMAC-SHA256 gerado pela VIS Platform pra este tenant.
  // Usado pra validar assinatura dos webhooks recebidos em /api/webhooks/vis.
  // NÃO em env var: arquitetura multi-tenant, cada tenant tem seu secret próprio.
  // Pode ser null pra tenants ainda não configurados na VIS.
  visWebhookSecret String?

  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users     User[]
  offers    Offer[]
  products  Product[]
  orders    Order[]
  events    EventLog[]

  @@index([slug])
  @@index([domain])
}

// ─────────────────────────────────────────
// USER — cliente da área de membros
// ─────────────────────────────────────────
model User {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])

  email     String
  phone     String?                  // formato E.164: +5511999999999
  cpf       String?                  // sem máscara
  name      String?

  // auth
  passwordHash String?               // null = só magic link
  emailVerified Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lastLoginAt DateTime?

  orders          Order[]
  entitlements    Entitlement[]
  accessTokens    AccessToken[]
  sessions        Session[]
  progress        Progress[]
  pushSubscriptions PushSubscription[]

  @@unique([tenantId, email])        // email único POR TENANT
  @@index([tenantId])
  @@index([email])
}

// ─────────────────────────────────────────
// OFFER — o que a VIS vende
// ─────────────────────────────────────────
model Offer {
  id              String   @id @default(uuid())
  tenantId        String
  tenant          Tenant   @relation(fields: [tenantId], references: [id])

  visProductId    Int      @unique   // id na VIS (vem em products[].id no webhook)
  visProductUuid  String?            // uuid na VIS (backup, pra logs)
  name            String             // "Missa Explicada Premium"
  description     String?
  price           Decimal  @db.Decimal(10, 2)
  active          Boolean  @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  offerProducts OfferProduct[]
  orderItems    OrderItem[]

  @@index([tenantId])
  @@index([visProductId])
}

// ─────────────────────────────────────────
// PRODUCT — o que o cliente consome
// ─────────────────────────────────────────
enum ProductType {
  EBOOK
  BONUS_PACK
  COMMUNITY
  VIDEO_COURSE
  AUDIO
  LIVE
  OTHER
}

model Product {
  id          String      @id @default(uuid())
  tenantId    String
  tenant      Tenant      @relation(fields: [tenantId], references: [id])

  name        String                  // "Ebook Missa Explicada"
  slug        String                  // "ebook-missa-explicada"
  type        ProductType
  description String?
  coverUrl    String?                 // capa exibida na home
  metadata    Json?                   // específico por tipo (ex: communityUrl pra COMMUNITY)
  active      Boolean     @default(true)
  sortOrder   Int         @default(0) // ordem de exibição na home

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  offerProducts OfferProduct[]
  contentItems  ContentItem[]
  orderItems    OrderItem[]
  entitlements  Entitlement[]

  @@unique([tenantId, slug])
  @@index([tenantId])
}

// ─────────────────────────────────────────
// OFFER_PRODUCT — junção: oferta libera produtos
// ─────────────────────────────────────────
model OfferProduct {
  id            String   @id @default(uuid())
  offerId       String
  offer         Offer    @relation(fields: [offerId], references: [id])
  productId     String
  product       Product  @relation(fields: [productId], references: [id])

  validityDays  Int?              // null = vitalício; 30 = 30 dias após concessão

  createdAt DateTime @default(now())

  @@unique([offerId, productId])
  @@index([offerId])
  @@index([productId])
}

// ─────────────────────────────────────────
// ORDER — compra na VIS
// ─────────────────────────────────────────
enum OrderStatus {
  CREATED
  PENDING
  APPROVED
  REFUSED
  CANCELLED
  REFUNDED
  CHARGEDBACK
}

model Order {
  id            String      @id @default(uuid())
  tenantId      String
  tenant        Tenant      @relation(fields: [tenantId], references: [id])
  userId        String
  user          User        @relation(fields: [userId], references: [id])

  visOrderId    Int         @unique   // order_id no payload VIS
  visOrderUuid  String?     @unique   // uuid no payload VIS

  status        OrderStatus
  amount        Decimal     @db.Decimal(10, 2)
  subtotal      Decimal     @db.Decimal(10, 2)
  discount      Decimal     @db.Decimal(10, 2) @default(0)
  paymentMethod String?                // credit_card, pix, boleto, pix_auto
  paymentGateway String?               // stripe, mercadopago, woovi

  // tracking VIS (replicado pra analytics)
  utmSource     String?
  utmMedium     String?
  utmCampaign   String?
  utmContent    String?
  utmTerm       String?
  src           String?                // usado como tenantId nas URLs de checkout
  sck           String?
  fbclid        String?
  gclid         String?
  ttclid        String?
  clickId       String?
  clickSource   String?

  // estado do provisionamento
  provisioned   Boolean     @default(false)
  provisionedAt DateTime?

  paidAt        DateTime?
  refundedAt    DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  items         OrderItem[]
  entitlements  Entitlement[]

  @@index([tenantId])
  @@index([userId])
  @@index([visOrderId])
  @@index([status])
}

// ─────────────────────────────────────────
// ORDER_ITEM — item dentro da order
// ─────────────────────────────────────────
model OrderItem {
  id          String   @id @default(uuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  offerId     String
  offer       Offer    @relation(fields: [offerId], references: [id])
  productId   String?              // se a Offer libera 1 Product, pré-resolve aqui
  product     Product? @relation(fields: [productId], references: [id])

  quantity    Int      @default(1)
  unitPrice   Decimal  @db.Decimal(10, 2)
  isBump      Boolean  @default(false)  // quando VIS expor a flag

  @@index([orderId])
  @@index([offerId])
}

// ─────────────────────────────────────────
// ENTITLEMENT — direito de acesso
// ─────────────────────────────────────────
enum EntitlementStatus {
  ACTIVE
  SUSPENDED              // reembolso/chargeback pendente
  REVOKED                // perda definitiva
  EXPIRED                // expirou pelo expiresAt
}

model Entitlement {
  id              String            @id @default(uuid())
  userId          String
  user            User              @relation(fields: [userId], references: [id])
  productId       String
  product         Product           @relation(fields: [productId], references: [id])
  sourceOrderId   String
  sourceOrder     Order             @relation(fields: [sourceOrderId], references: [id])

  status          EntitlementStatus @default(ACTIVE)
  grantedAt       DateTime          @default(now())
  expiresAt       DateTime?                // null = vitalício
  suspendedAt     DateTime?
  revokedAt       DateTime?
  reactivatedAt   DateTime?

  reason          String?                  // motivo de suspensão/revogação

  @@index([userId, status])
  @@index([productId])
  @@index([sourceOrderId])
}

// ─────────────────────────────────────────
// CONTENT_ITEM — arquivo/link dentro de um Product
// ─────────────────────────────────────────
enum ContentItemType {
  PDF
  AUDIO_FILE
  VIDEO_FILE
  VIDEO_EMBED            // youtube, vimeo, bunny
  EXTERNAL_LINK          // comunidade WhatsApp/Telegram
  TEXT                   // texto rico inline
}

model ContentItem {
  id          String          @id @default(uuid())
  productId   String
  product     Product         @relation(fields: [productId], references: [id])

  type        ContentItemType
  title       String
  description String?

  // por tipo:
  fileKey     String?                  // chave no Supabase Storage (PDF, AUDIO_FILE, VIDEO_FILE)
  externalUrl String?                  // EXTERNAL_LINK, VIDEO_EMBED
  textContent String?                  // TEXT
  metadata    Json?

  sortOrder   Int             @default(0)
  active      Boolean         @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  progress    Progress[]

  @@index([productId])
}

// ─────────────────────────────────────────
// ACCESS_TOKEN — token single-use pós-checkout
// ─────────────────────────────────────────
model AccessToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  orderId   String?              // qual order gerou (opcional pra magic links manuais)

  token     String    @unique   // UUID, vai na URL
  expiresAt DateTime             // now + 15min
  usedAt    DateTime?            // null = não usado ainda

  createdAt DateTime @default(now())

  @@index([userId])
  @@index([token])
  @@index([expiresAt])
}

// ─────────────────────────────────────────
// SESSION — sessão Lucia
// ─────────────────────────────────────────
model Session {
  id        String   @id
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}

// ─────────────────────────────────────────
// PROGRESS — consumo de ContentItem
// ─────────────────────────────────────────
enum ProgressStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
}

model Progress {
  id              String         @id @default(uuid())
  userId          String
  user            User           @relation(fields: [userId], references: [id])
  contentItemId   String
  contentItem     ContentItem    @relation(fields: [contentItemId], references: [id])

  status          ProgressStatus @default(IN_PROGRESS)
  startedAt       DateTime       @default(now())
  completedAt     DateTime?
  lastAccessedAt  DateTime       @default(now())

  @@unique([userId, contentItemId])
  @@index([userId])
}

// ─────────────────────────────────────────
// PUSH_SUBSCRIPTION — endpoint Web Push
// ─────────────────────────────────────────
model PushSubscription {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])

  endpoint  String   @unique
  keys      Json                  // { p256dh, auth }
  userAgent String?
  active    Boolean  @default(true)

  createdAt DateTime @default(now())
  lastUsedAt DateTime?

  @@index([userId])
}

// ─────────────────────────────────────────
// EVENT_LOG — auditoria de eventos de negócio
// ─────────────────────────────────────────
model EventLog {
  id          String   @id @default(uuid())
  tenantId    String?
  tenant      Tenant?  @relation(fields: [tenantId], references: [id])

  type        String              // "webhook.received", "order.provisioned", etc
  payload     Json
  userId      String?
  orderId     String?
  level       String   @default("info")  // info, warn, error
  message     String?

  createdAt DateTime @default(now())

  @@index([type])
  @@index([tenantId, createdAt])
}

// ─────────────────────────────────────────
// WEBHOOK_DELIVERY — log de webhooks recebidos
// ─────────────────────────────────────────
model WebhookDelivery {
  id              String   @id @default(uuid())
  tenantId        String?
  visEvent        String              // order.approved, etc
  visDeliveryId   String?             // header X-Webhook-Delivery-Id
  signatureValid  Boolean
  payloadHash     String              // sha256 do payload, pra dedup
  rawPayload      Json
  processed       Boolean  @default(false)
  processedAt     DateTime?
  errorMessage    String?

  createdAt DateTime @default(now())

  @@unique([payloadHash])            // idempotência forte
  @@index([visDeliveryId])
  @@index([processed])
}
```

### Índices e performance
- Todo `tenantId` é indexado.
- Todo `visOrderId`, `visProductId` é único + indexado (idempotência).
- `Entitlement(userId, status)` é o índice mais quente — toda página da área de membros consulta.
- `payloadHash` em `WebhookDelivery` garante que webhook duplicado nunca processa duas vezes.

---

## 6. Autenticação e sessão

### Mecanismos suportados
1. **Token de acesso (magic link)** — primary, usado pós-compra e em "esqueci o acesso"
2. **Login com email + senha** — se o usuário CRIAR senha depois (opcional)
3. **NUNCA SSO de terceiros** — pra manter simples e independente

### Fluxo do magic link / token
```
1. User clica em link: /auth/redeem?t=<UUID>
2. Servidor busca AccessToken WHERE token = UUID AND usedAt IS NULL AND expiresAt > now
3. Se não existe ou expirou: mostra tela "link expirou — receba novo no seu email/WhatsApp"
4. Se OK:
   - Marca usedAt = now (queima o token)
   - Cria Session via Lucia
   - Set cookie httpOnly + secure + sameSite=lax
   - Redirect para /home
```

### Política de sessão
- Cookie httpOnly, secure (prod), sameSite=lax
- Validade da sessão: 30 dias rolling (renova a cada acesso)
- Logout: invalida sessão server-side (DELETE em Session)
- Token de acesso (não a sessão): 15min de validade, single-use

---

## 7. Autorização (entitlements)

### Função canônica de checagem
```typescript
async function hasAccess(userId: string, productId: string): Promise<boolean> {
  const e = await prisma.entitlement.findFirst({
    where: {
      userId,
      productId,
      status: 'ACTIVE',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });
  return !!e;
}
```

Esta função é **única fonte de verdade** pra "X tem acesso a Y". Todo endpoint que serve conteúdo (signed URL de PDF, redirect pra comunidade, etc) chama `hasAccess` antes.

### Estados do entitlement e transições

```
        ┌─────────┐
        │ ACTIVE  │◄────────────────┐
        └────┬────┘                 │
             │                      │
             ├─── expiresAt < now ──┼──► EXPIRED
             │                      │
             ├─── refunded/charged ─┼──► SUSPENDED ──── reembolso cancelado ──┘
             │                      │
             └─── manual revoke ────┘──► REVOKED (terminal)
```

Apenas SUSPENDED pode voltar pra ACTIVE. REVOKED e EXPIRED são terminais.

---

## 8. Notificações

### Canais
1. **WhatsApp** — link de acesso pós-compra, lembretes críticos
2. **Email** — backup do link de acesso, recibos, comunicações longas
3. **Push (Web Push API)** — engajamento, upsell, lembretes leves

### Padrão de envio
Toda notificação passa pela camada `lib/notifications/` que tem:
- Fila com retry (simples, in-process por enquanto, fila externa só se volume justificar)
- Template engine por tenant (cada tenant tem templates próprios)
- Throttling por usuário (max N notificações/dia)
- Opt-out por canal

### Critérios para usar push notification
**Quando usar:**
- Cliente comprou produto X mas não acessou conteúdo em 3 dias
- Novo produto disponível na esteira do cliente
- Lembrete leve de retomada de consumo

**Quando NÃO usar:**
- Operações críticas (link de acesso) — sempre WhatsApp + email primeiro
- Comunicação longa ou que exige resposta
- Mais de 1x por dia por usuário

---

## 9. Multi-tenancy: detalhes operacionais

### Branding por tenant
Campo `Tenant.branding` (JSON) contém:
```json
{
  "appName": "Missa Explicada",
  "logoUrl": "https://...",
  "primaryColor": "#7C3AED",
  "themeColor": "#FFFFFF",
  "supportEmail": "suporte@missaexplicada.com.br",
  "supportWhatsapp": "+5511...",
  "manifestIcons": [...]
}
```

PWA manifest é gerado dinamicamente em `/app/manifest.ts` lendo o tenant da request.

### Domínio por tenant
- Production: `app.<dominio-do-tenant>.com.br`
- Dev: `<slug>.localhost:3000`
- Wildcards Vercel: configurar via Vercel Domains API

### Isolamento de dados (regras absolutas)
1. Todo query Prisma de tabela tenant-scoped DEVE incluir `tenantId`. Sem exceção.
2. O `tenantId` é resolvido pelo proxy e propagado conforme a subseção "Propagação de tenant".
3. Helper `scoped-db` (Prisma Client Extension) injeta o `tenantId` automaticamente. Ver "Estratégia do scoped-db".
4. Testes de integração validam que User do Tenant A NUNCA recebe dado do Tenant B.

### Runtime do proxy

O `src/proxy.ts` (convenção `proxy.ts` do Next 16, sucessora de `middleware.ts`)
roda em **Node.js runtime** — padrão dessa convenção, sem precisar declarar
`runtime`. Motivo: a resolução de tenant consulta o banco (Prisma Client, que
não roda no Edge) e o projeto usa `AsyncLocalStorage`. O custo de cold start é
irrelevante (Vercel + sa-east-1) e o resolver tem cache em memória (TTL 60s) —
o proxy faz no máximo 1 query por tenant a cada 60s.

### Propagação de tenant

- **Dentro de uma request:** o proxy resolve o tenant e injeta o header
  `X-Tenant-Id` na request. Server Components e Route Handlers leem via
  `next/headers`. O `AsyncLocalStorage` NÃO é populável a partir do proxy
  (runtime separado do render) — o header é o transporte real.
- **Fora de request** (seed, testes, scripts CLI): usa `AsyncLocalStorage` via
  `withTenantContext(tenantId, fn)`.
- `getCurrentTenantId()` lê primeiro do `AsyncLocalStorage` e, se vazio, faz
  fallback para o header `X-Tenant-Id`.

### Estratégia do scoped-db

`src/lib/tenant/scoped-db.ts` é uma Prisma Client Extension que aplica o
`tenantId` do contexto atual. Regras por operação, nos modelos tenant-scoped
(`User`, `Offer`, `Product`, `Order`):

- **Auto-inject no `where`:** `findMany`, `findFirst`, `update`, `updateMany`,
  `delete`, `deleteMany`, `count`, `aggregate`, `groupBy`.
- **Bloqueado:** `findUnique` / `findUniqueOrThrow` — lançam erro orientando a
  usar `findFirst` (não há como filtrar `tenantId` num lookup por chave única).
- **Validado (não injetado):** `create`, `createMany`, `upsert` — exigem
  `tenantId` no `data`; havendo contexto de tenant ativo, deve bater com ele.
- **Modelos sem `tenantId`** (`Session`, `AccessToken`, `WebhookDelivery`,
  `PushSubscription`, etc.) passam direto, sem alteração.
- **`EventLog`** é caso especial (`tenantId` opcional): se presente no `data`,
  é validado contra o contexto; se ausente, é permitido (eventos globais).

Detalhamento e justificativa em `docs/DECISIONS/001-scoped-db-strategy.md`.

---

## 10. Segurança

### Não-negociáveis
1. Webhook só processa se HMAC-V1 válido E timestamp dentro de 5 min E `WebhookDelivery.payloadHash` não duplicado.
2. PDF NUNCA é servido por URL pública. Sempre signed URL com expiração de 15 min, gerada após `hasAccess`.
3. AccessToken é single-use. Tentativa de reuso → 401 + log de incidente.
4. Senhas (quando existirem) são Argon2id.
5. Logs NUNCA contém: tokens, payment_id, dados de cartão.
6. Rate limiting em endpoints públicos: `/auth/redeem` (5/min/IP), `/api/webhooks/vis` (sem limit mas com fila), `/api/auth/request-magic-link` (3/15min/email).
7. Cookies sempre secure em prod, httpOnly, sameSite=lax.

### LGPD
- Email, CPF, telefone são PII. Backup criptografado em repouso (Supabase já faz).
- Endpoint `/conta/exportar-dados` (Fase 5+) — usuário baixa tudo dele.
- Endpoint `/conta/excluir` — anonimiza User, mantém Order/Entitlement por compliance fiscal.

---

## 11. Observabilidade

### O que registramos em EventLog
- `webhook.received` — todo webhook recebido (independente de processar ou não)
- `webhook.validated` — passou HMAC
- `webhook.processed` — entitlements criados
- `webhook.failed` — falha no processamento (com motivo)
- `order.provisioned` — provisionamento completo
- `entitlement.granted` / `entitlement.suspended` / `entitlement.revoked`
- `access.token_generated` / `access.token_redeemed` / `access.token_expired`
- `user.first_login` — métrica de ativação
- `content.accessed` — qual ContentItem foi consumido
- `upsell.clicked` — clique em card de cross-sell na home

### Métricas que dependem disso (Fase 6)
- **Ativação:** % de Orders com `access.token_redeemed` em até 24h
- **Engajamento D1:** % de Users com `content.accessed` em 24h pós-compra
- **Engajamento D7:** % com ≥1 `content.accessed` em 7 dias
- **Upsell CTR:** clicks em upsell / impressões
- **Upsell conversão:** segunda compra do mesmo User no mesmo Tenant
- **Tempo médio entre compras** do mesmo User
- **Churn de comunidade** (Fase posterior)

---

## 12. Estrutura de pastas

```
vis-membros/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                       # seed do tenant Missa Explicada pra dev
├── src/
│   ├── app/
│   │   ├── (public)/                 # rotas sem auth
│   │   │   ├── login/
│   │   │   ├── obrigado/             # página de polling pós-checkout
│   │   │   └── auth/
│   │   │       ├── redeem/           # consome AccessToken
│   │   │       └── magic-link/
│   │   ├── (member)/                 # rotas autenticadas (PWA shell)
│   │   │   ├── layout.tsx
│   │   │   ├── home/
│   │   │   ├── produtos/[slug]/
│   │   │   ├── conta/
│   │   │   └── _components/          # UI shared do shell
│   │   ├── (admin)/                  # Fase 5
│   │   ├── api/
│   │   │   ├── webhooks/
│   │   │   │   ├── vis/route.ts
│   │   │   │   └── vis/simulate/route.ts    # gated por env, só dev
│   │   │   ├── orders/
│   │   │   │   └── status/route.ts         # polling endpoint
│   │   │   ├── content/
│   │   │   │   └── [id]/signed-url/route.ts
│   │   │   ├── auth/
│   │   │   │   ├── redeem/route.ts
│   │   │   │   └── magic-link/route.ts
│   │   │   └── push/
│   │   │       ├── subscribe/route.ts
│   │   │       └── vapid-key/route.ts
│   │   ├── manifest.ts               # PWA manifest dinâmico por tenant
│   │   └── layout.tsx                # root layout
│   ├── lib/
│   │   ├── db.ts                     # Prisma client singleton
│   │   ├── auth/
│   │   │   ├── lucia.ts
│   │   │   ├── tokens.ts             # gerar/validar AccessToken
│   │   │   └── session.ts
│   │   ├── tenant/
│   │   │   ├── resolver.ts           # domínio → tenant
│   │   │   ├── context.ts            # AsyncLocalStorage
│   │   │   └── scoped-db.ts          # Prisma wrapper com tenantId
│   │   ├── webhooks/
│   │   │   ├── vis-signature.ts      # validação HMAC-V1
│   │   │   ├── vis-resolver.ts       # payload → tenant
│   │   │   └── provision.ts          # provisionamento completo
│   │   ├── entitlements/
│   │   │   ├── grant.ts
│   │   │   ├── suspend.ts
│   │   │   ├── revoke.ts
│   │   │   └── check.ts              # hasAccess()
│   │   ├── notifications/
│   │   │   ├── whatsapp.ts
│   │   │   ├── email.ts
│   │   │   └── push.ts
│   │   ├── storage/
│   │   │   └── signed-urls.ts
│   │   └── observability/
│   │       ├── event-log.ts
│   │       └── sentry.ts
│   ├── components/
│   │   ├── member/
│   │   └── admin/
│   ├── proxy.ts                      # tenant detection + auth gate (Next 16)
│   └── types/
├── public/
│   ├── icons/                        # PWA icons (default + per-tenant)
│   └── sw.js                         # service worker
├── tests/
│   ├── unit/
│   ├── integration/
│   │   ├── webhook/                  # testes de provisionamento
│   │   └── tenant-isolation/         # testes que validam isolamento
│   └── e2e/
│       └── fluxo-compra-ate-acesso.spec.ts
├── docs/
│   ├── ARCHITECTURE.md               # este documento
│   ├── WEBHOOK_CONTRACT.md           # contrato com VIS
│   ├── PHASES.md                     # roadmap detalhado
│   ├── DECISIONS/                    # ADRs (Architecture Decision Records)
│   └── RUNBOOK.md                    # procedimentos operacionais
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 13. Variáveis de ambiente

```bash
# Banco (Supabase Postgres)
# DATABASE_URL: pooler (porta 6543) — usado pelo Prisma Client em runtime
# DIRECT_URL: direct connection (porta 5432) — usado pelo Prisma Migrate
# Ambos obrigatórios. Sem DIRECT_URL, migrations falham contra Supabase.
DATABASE_URL="postgresql://user:password@host:6543/db?pgbouncer=true"
DIRECT_URL="postgresql://user:password@host:5432/db"

# Auth
SESSION_SECRET=                       # 64 chars random

# VIS Platform
# OBS: NÃO armazenar webhook secret em env var. Cada tenant tem seu próprio
# secret, armazenado em Tenant.visWebhookSecret no banco. Esta env var
# existe APENAS pra um secret fallback de desenvolvimento.
VIS_WEBHOOK_SECRET_DEV=               # opcional, fallback para tenant sem secret cadastrado

# WhatsApp (Evolution API ou Z-API)
WHATSAPP_API_URL=
WHATSAPP_API_KEY=
WHATSAPP_INSTANCE=

# Email
RESEND_API_KEY=
EMAIL_FROM=

# Storage
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Push
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:suporte@...

# Observabilidade
SENTRY_DSN=

# Feature flags
ENABLE_WEBHOOK_SIMULATOR=false        # true só em dev
```

---

## 14. Glossário rápido

| Termo | Significado |
|-------|-------------|
| Tenant | Nicho/marca isolado (Missa Explicada, Protocolo Alpha) |
| Offer | Produto na nomenclatura VIS (o que o checkout vende) |
| Product | O que o cliente consome na área de membros |
| Entitlement | Direito de acesso de um User a um Product |
| ContentItem | Arquivo/link dentro de um Product |
| AccessToken | Token single-use de 15min pra login automático |
| VIS | VIS Platform — gateway de checkout do Mateus |
| Webhook delivery | Cada chegada de webhook (com seu próprio ID) |
| Provisionamento | Processo de criar User+Order+Entitlements a partir de webhook |
| PWA | Progressive Web App — instalável no celular |

---

## 15. Como usar este documento com Claude Code

Em todo prompt do Claude Code, **inclua o trecho relevante deste documento** no contexto. Não é pra colar o doc inteiro — é pra colar a seção pertinente.

Exemplos:
- "Implementar webhook" → cola seções 4, 5 (modelos Order/Entitlement/WebhookDelivery), 10 (segurança)
- "Criar página de home" → cola seções 2, 5 (modelos User/Product/Entitlement), 7 (autorização)
- "Implementar push" → cola seções 5 (PushSubscription), 8 (notificações)

E sempre referenciar `PHASES.md` pra saber em qual fase está e quais critérios de aceite.
