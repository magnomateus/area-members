# WEBHOOK_CONTRACT.md — Integração VIS Platform ↔ Plataforma de Membros

> **Documento de contrato.** Define exatamente como a Plataforma de Membros consome webhooks da VIS Platform. Toda mudança no contrato é deliberada e versionada. Mudanças do lado VIS devem ser aditivas.

> **Versão:** 2.0 • **Última atualização:** Maio/2026 • **Aplica-se a:** Fases 1.3 em diante

> **Changelog 2.0 (baseado em descobertas reais validadas com o Mateus):**
> (a) Evento `webhook.test` documentado — botão de teste no painel VIS dispara esse evento.
> (b) Order bumps confirmados misturados em `data.products[]` sem flag distinguidora.
> (c) Timeout do webhook é 30s (não 10s como assumido antes).
> (d) `order.chargedback` agora dispara separadamente de `order.refunded` (correção do Mateus).
> (e) Documentação do `src` está em `app/Services/OutboundWebhookService.php → buildOrderPayload()` do código VIS, marcado como contrato externo.
> (f) Estratégia de integração da Fase 1: produto DEV dedicado para desenvolvimento + suporte a múltiplos webhooks por produto chega em fase futura (Mateus se ofereceu a implementar).
> (g) `?secret=` na query string de webhook URLs é anti-pattern e NÃO será usado.
> (h) Sub-fases 1.3a (core handler) + 1.3b (provisionamento) introduzidas.

---

## 1. Visão geral da integração

A integração tem **três pontos de contato** entre VIS e Plataforma de Membros:

1. **URL de checkout** — link onde o cliente compra. Carrega `?src=tenant_<slug>` pra identificar o tenant.
2. **Webhook outbound (VIS → Membros)** — VIS notifica eventos de pedido/pagamento.
3. **Página de obrigado + polling** — após pagamento, cliente é redirecionado pra `thank_you_url` (página hospedada no app de membros), que faz polling pra detectar quando o provisionamento concluiu.

O redirect e o webhook são **caminhos independentes**. O sistema é resiliente a qualquer ordem ou atraso entre os dois.

```
┌─────────────────┐
│ Página de venda │
└────────┬────────┘
         │ link com ?src=tenant_<slug>
         ▼
┌─────────────────┐
│ Checkout VIS    │
└────────┬────────┘
         │
    ┌────┴─────────────┐
    │                  │
    ▼ (síncrono)       ▼ (assíncrono)
┌─────────────┐    ┌──────────────────┐
│ thank_you   │    │ POST webhook     │
│ _url        │    │ /api/webhooks/vis│
│ (no nosso   │    │ (no nosso app)   │
│ app)        │    │                  │
│             │    │ provisiona, gera │
│ polling     │◄───┤ AccessToken      │
│ encontra    │    └──────────────────┘
│ token,      │
│ redireciona │
└─────────────┘
```

---

## 2. Estratégia de integração — Fase 1 vs Produção

### Por que essa estratégia existe

A VIS hoje suporta **apenas UMA URL de webhook por produto** (`products.webhook_url`). O produto Missa Explicada (id 20) já tem seu webhook apontando pro `vis-dashboard` (analytics de ads que o Mateus já desenvolveu). Não podemos simplesmente "pegar" esse webhook pro app de membros sem perder o analytics.

### Estratégia adotada (Opção 1 + Opção 4)

**Durante a Fase 1 (desenvolvimento):**

- Mateus cria um produto novo na VIS: **"Missa Explicada DEV"** (ou similar)
- Esse produto tem `webhook_url` apontando para o app de membros (via ngrok em local, ou direto pra staging quando deploy)
- Esse produto tem `webhook_secret` próprio (não compartilha com o produto 20 real)
- Permite desenvolver e testar TODA a Fase 1 sem mexer no produto de produção
- Custo: ~5 minutos do Mateus pra criar

**Para Fase 1.7 (deploy em prod com cliente real):**

- Mateus implementa suporte a **múltiplos webhooks por produto** na VIS (tabela `product_webhooks` 1-N, cada um com seu secret)
- Custo: ~1 sprint dele
- Quando pronto, o produto 20 (Missa Explicada real) dispara webhook PARA AMBOS: vis-dashboard E app de membros
- Zero acoplamento entre os dois sistemas
- Benefício futuro: outros sistemas (CRM, etc) podem ser plugados sem refactor

### Mapeamento produto → tenant (estado atual)

| Produto VIS | ID | Slug VIS | Tenant da Plataforma de Membros | Status integração |
|-------------|----|----|---------------------------------|-------------------|
| Missa Explicada DEV | (a definir) | missa-explicada-dev | missa-explicada | Fase 1.3a-1.7 (desenvolvimento) |
| Missa Explicada | 20 | missa-explicada | missa-explicada | Fase 1.7 em diante (produção) |
| Missa Explicada Infantil | 23 | (futuro) | (a definir) | Fase 2+ |
| Missa Explicada Completo | 29 | (futuro) | missa-explicada | Fase 2+ |
| Material Missa Explicada | 31 | (futuro) | missa-explicada | Fase 2+ |
| App Missa Explicada Mensal | 33 | (futuro) | (a definir) | Fase 2+ |
| App Missa Explicada Semestral | 34 | (futuro) | (a definir) | Fase 2+ |
| App Missa Explicada Anual | 35 | (futuro) | (a definir) | Fase 2+ |
| Missa Explicada (afiliado) | 41 | (futuro) | missa-explicada | Fase 2+ |

> **Importante:** TODOS esses produtos serão tenants do MESMO `missa-explicada` (decisão arquitetural — agrupamento por nicho/marca). O cliente que compra qualquer um deles vê tudo no mesmo app, com cada produto liberando os ContentItems correspondentes via Entitlements.

---

## 3. URLs de checkout

### Formato canônico
```
https://checkout.visplatform.com/produto/<slug-do-produto>?src=tenant_<slug-tenant>
```

### Por que `src`?
A VIS não tem campo `metadata` livre no checkout, mas tem `src` (e `sck`) que vêm no `tracking` do webhook. Usamos `src` como canal oficial pra passar `tenantId`.

**Convenção:** `src` SEMPRE no formato `tenant_<slug-tenant>` para uso da Plataforma de Membros. Outros usos de `src` (UTM tradicional, etc) NÃO devem colidir com esse prefixo. Validar regex `^tenant_[a-z0-9-]+$` no webhook handler.

### Documentação do `src` no lado VIS

Mateus marcou o `src` como contrato externo em:
- Arquivo: `app/Services/OutboundWebhookService.php`
- Método: `buildOrderPayload()`
- Comentário: bloco acima da montagem do array `tracking`
- Anotação: `"CONTRATO DE INTEGRACAO EXTERNA — NAO REMOVER NEM RENOMEAR"`
- Campos `src` e `sck` anotados inline como `"uso livre — tenantId nas integrações externas"`

Isso protege contra remoção acidental no futuro.

### Fallback se `src` ausente
Se um link de checkout for compartilhado sem `src`, o webhook chega sem ele. **Fallback:** o serviço resolve o tenant via `Offer.visProductId` → `Offer.tenantId`. Cada produto VIS pertence a UM tenant nosso (constraint do banco), então a resolução é determinística.

---

## 4. Configuração do webhook na VIS

Para cada produto integrado, configurar no painel VIS:

| Campo | Valor |
|-------|-------|
| `webhook_url` | `https://app.<dominio-do-tenant>/api/webhooks/vis` |
| `webhook_secret` | gerado pela VIS (64 chars), armazenado em `Offer.visWebhookSecret` (banco do app) — cada produto VIS tem o seu |
| `thank_you_url` | `https://app.<dominio-do-tenant>/obrigado?order_id={{order_id}}&email={{email}}` |

> **⚠️ NÃO usar `?secret=` na query string da `webhook_url`.** Esse é um anti-pattern que o vis-dashboard usa, mas vaza o segredo em logs de servidor, navegador, proxies intermediários e headers `Referer`. Nossa autenticação é EXCLUSIVAMENTE via HMAC-V1 nos headers, conforme seção 5.

**Pendência a confirmar com Mateus:** a `thank_you_url` aceita placeholders dinâmicos como `{{order_id}}` e `{{email}}` no momento do redirect? Se sim, o polling fica trivial. Se não, o backend descobre via parâmetros que a VIS já adiciona automaticamente.

---

## 5. Headers e payload do webhook

### Headers que a VIS envia
```
Content-Type: application/json
User-Agent: VIS-Platform-Webhook/1.0
X-Webhook-Event: order.approved | order.refunded | order.chargedback | webhook.test | ...
X-Webhook-Product-Id: 20
X-Webhook-Delivery-Id: <uuid>
X-Webhook-Signature: <hmac-sha256-do-body>
X-Webhook-Signature-V1: t=<unix-ts>,v1=<hmac-sha256-de-(ts.body)>
```

### Validação de assinatura

**SEMPRE usar `X-Webhook-Signature-V1`** (com timestamp, previne replay). O fallback para `X-Webhook-Signature` simples é REJEITADO — se o V1 estiver ausente, retornar 400.

```typescript
function verifyWebhookV1(
  header: string,           // "t=1684343000,v1=abcd1234..."
  rawBody: string,
  secret: string,
  maxAgeSec: number = 300   // 5 minutos
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('='))
  );
  const ts = parseInt(parts.t, 10);
  const v1 = parts.v1;

  // 1. Idade (anti-replay)
  const ageSec = Math.floor(Date.now() / 1000) - ts;
  if (ageSec > maxAgeSec || ageSec < -30) return false;

  // 2. Assinatura
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');

  // 3. Timing-safe comparison (anti-side-channel)
  return crypto.timingSafeEqual(
    Buffer.from(v1, 'hex'),
    Buffer.from(expected, 'hex')
  );
}
```

**Importante:** validar o RAW BODY como recebido. Qualquer reformatação JSON quebra a assinatura.

### Body — exemplo de `order.approved`
```json
{
  "event": "order.approved",
  "timestamp": "2026-05-17T14:30:00-03:00",
  "data": {
    "order_id": 3678,
    "uuid": "ab93d03f-505d-4e9c-871d-62da0ab33af7",
    "payment_id": "pi_3TLEFq7MEObDdxjN0Xk3AqE0",
    "status": "approved",
    "payment_method": "credit_card",
    "payment_gateway": "stripe",
    "total": 197.00,
    "subtotal": 197.00,
    "discount": 0,
    "customer": {
      "name": "Nome do Cliente",
      "email": "cliente@email.com",
      "phone": "5511999999999",
      "cpf": "12345678900"
    },
    "products": [
      { "id": 20, "name": "Missa Explicada", "quantity": 1, "price": 197.00 }
    ],
    "tracking": {
      "utm_source": "FB",
      "utm_medium": "...",
      "utm_campaign": "...",
      "utm_content": "...",
      "utm_term": "...",
      "src": "tenant_missa-explicada",
      "sck": null,
      "fbclid": "...",
      "gclid": null,
      "ttclid": null,
      "click_id": "...",
      "click_source": "facebook",
      "referrer": null,
      "referrer_domain": null,
      "ip_address": "201.x.x.x",
      "user_agent": "...",
      "device_type": "mobile",
      "browser": null, "os": null,
      "country": null, "region": null, "city": null
    },
    "created_at": "2026-05-17T14:28:00-03:00",
    "paid_at": "2026-05-17T14:30:00-03:00",
    "refunded_at": null
  }
}
```

### Body — `webhook.test` (NOVA descoberta importante)

O botão "Testar Webhook" no painel VIS (Produtos → editar → seção Webhook URL → "Testar Webhook") dispara um evento `webhook.test` com **estrutura idêntica** ao `order.approved`, mas:

- `event: "webhook.test"`
- Campo extra `"test": true` na raiz do payload
- `data.order_id: 0`
- `data.payment_gateway: "teste"`
- `data.customer.name: "Cliente de Teste"`
- `data.tracking.src: "tenant_exemplo"`
- HMAC válido (assinado normalmente)
- Header `X-Webhook-Event: webhook.test`

**Comportamento esperado do nosso handler:**
- Reconhecer o evento `webhook.test`
- Validar HMAC (sim, mesmo em teste)
- **NÃO provisionar nada** (sem User, sem Order, sem Entitlement)
- Logar em EventLog (tipo `webhook.test.received`)
- Retornar 200 OK com `{ ok: true, event: "webhook.test", message: "Test received and validated" }`

Isso permite o Mateus testar a integração sem criar entitlements falsos no banco.

### Campos que CONSUMIMOS no order.approved

| Campo | Uso |
|-------|-----|
| `event` | Roteamento do handler |
| `data.order_id` | `Order.visOrderId` (idempotência forte, Int) |
| `data.uuid` | `Order.visOrderUuid` (UUID do pedido) |
| `data.status` | `Order.status` (mapeado para nosso enum) |
| `data.payment_method` | `Order.paymentMethod` |
| `data.payment_gateway` | `Order.paymentGateway` |
| `data.total` | `Order.amount` |
| `data.subtotal` / `discount` | `Order.subtotal` / `Order.discount` |
| `data.customer.email` | Chave do User (com `tenantId`) |
| `data.customer.name` | `User.name` |
| `data.customer.phone` | `User.phone` (normalizado pra E.164) |
| `data.customer.cpf` | `User.cpf` (limpa máscara) |
| `data.products[]` | Cada item → `OrderItem` + entitlements |
| `data.products[].id` | `Offer.visProductId` (lookup, Int) |
| `data.tracking.src` | Resolução de tenant (primary) |
| `data.tracking.utm_*` | Replicado em `Order.utm*` |
| `data.tracking.fbclid` / `gclid` / `ttclid` / `click_id` | Replicado em `Order.*` |
| `data.paid_at` | `Order.paidAt` |
| `data.refunded_at` | `Order.refundedAt` (em events de refund) |
| `data.created_at` | comparação com `Order.createdAt` |

### Campos que NÃO consumimos (mas armazenamos em EventLog/WebhookDelivery)
- `data.payment_id` — sensível, não armazenar em Order. Útil pra diagnóstico se Mateus precisar correlacionar.
- `data.tracking.ip_address`, `user_agent`, `referrer_domain` — armazenar em raw payload, não em Order.

### Order bumps no array `products[]` (GAP CONHECIDO)

**Confirmado pelo Mateus:** o webhook NÃO expõe `is_bump`. Todos os itens (produto principal + bumps) vêm misturados em `data.products[]` sem flag distinguidora. Internamente a VIS sabe (`is_bump` no banco da VIS), mas isso não é exposto no payload do webhook.

**Decisão para Fase 1:** provisionamos entitlements pra todos os itens em `products[]`, sem distinção. Isso é correto funcionalmente (cliente comprou, cliente acessa), mas perde a métrica de "% de bumps aceitos".

**Pendência:** pedir ao Mateus a inclusão da flag `is_bump` no payload em fase futura (registrado no fim deste documento).

---

## 6. Política de retry da VIS

- Até **5 tentativas** por delivery
- Backoff: 1min → 5min → 30min → 2h → 24h
- Status `exhausted` após 5 falhas
- **Timeout de cada request: 30 segundos** (aumentado de 10s — Mateus identificou que serverless cold start estava dando timeout falso)
- Connect timeout: 10s
- VIS considera sucesso: HTTP 2xx

### Implicação: nosso handler precisa terminar em <5s

Embora a VIS espere 30s, nosso handler deve **provisionar de forma síncrona em menos de 5s** e mover notificações (WhatsApp, email) pra **fila assíncrona**. Razões:
- UX: cliente está fazendo polling, quanto mais rápido, melhor
- Vercel: cold start + transação + envio = pode estourar com volume
- Resilência: se WhatsApp falhar, não bloqueia o webhook

### Como nosso webhook lida com retry

1. Sempre retornar 2xx o mais rápido possível
2. Validação (HMAC, formato) inválida → **400** (não retentar — está quebrado)
3. Processamento OK → **200**
4. Erro transitório (banco fora, fila cheia) → **500** (deixa retentar)
5. Erro permanente no processamento (dados inconsistentes nossos) → **200** + log de erro + alerta interno (não adianta retentar)

### Idempotência (3 camadas)

1. **Por `visOrderId` único** em `Order` — não cria duas Orders pra mesma compra
2. **Por `payloadHash` único** em `WebhookDelivery` — não processa dois webhooks idênticos
3. **Por `visDeliveryId`** (header) — não processa duas vezes o mesmo delivery

### Processamento idempotente (pseudocódigo)
```typescript
async function handleWebhook(rawBody: string, headers: WebhookHeaders) {
  const payloadHash = sha256(rawBody);
  const delivery = await prisma.webhookDelivery.upsert({
    where: { payloadHash },
    create: { /* ... */ processed: false },
    update: {},
  });

  if (delivery.processed) {
    return { ok: true, message: 'already processed' };
  }

  // Valida HMAC, processa em transação atômica, marca delivery.processed = true
}
```

---

## 7. Mapeamento de eventos → ações

| Evento VIS | Ação no app de membros |
|------------|------------------------|
| `webhook.test` | Valida HMAC, loga em EventLog, retorna 200 SEM provisionar |
| `order.created` | Cria Order(status=CREATED); NÃO provisiona |
| `order.approved` | Provisionamento completo: upsert User, Order=APPROVED, Entitlements=ACTIVE, AccessToken, notificações |
| `order.refused` | Order=REFUSED; nenhum entitlement |
| `order.cancelled` | Order=CANCELLED; entitlements existentes=SUSPENDED |
| `order.refunded` | Order=REFUNDED; entitlements daquele sourceOrderId=SUSPENDED; envia email "acesso suspenso" |
| `order.chargedback` | Order=CHARGEDBACK; entitlements=SUSPENDED; alerta interno (fraude potencial) |
| `subscription.created` | (Fase futura) Cria Subscription, primeiro Entitlement |
| `subscription.renewed` | (Fase futura) Estende validity dos entitlements |
| `subscription.payment_failed` | (Fase futura) Notifica usuário |
| `subscription.cancelled` | (Fase futura) Entitlements expiram no fim do ciclo atual |
| `subscription.suspended` | (Fase futura) Entitlements=SUSPENDED |
| `subscription.reactivated` | (Fase futura) Entitlements=ACTIVE |
| `access.granted` / `access.revoked` | **A confirmar com Mateus** — log apenas em Fase 1 |

> **Importante sobre `order.chargedback`:** Mateus identificou e CORRIGIU um bug — antes, chargeback e refund caíam no mesmo handler que sempre disparava `order.refunded`. Agora os eventos são distintos. **Mas ainda não foi validado end-to-end em produção** (precisa de uma transação real com chargeback pra confirmar). Em caso de comportamento estranho desse evento, é prioridade testar.

---

## 8. Endpoint do webhook — algoritmo completo

```
POST /api/webhooks/vis

1. Lê headers e raw body (sem parsear ainda)
2. Calcula payloadHash = sha256(rawBody)
3. UPSERT WebhookDelivery por payloadHash
   - Se já processed=true → 200 OK { duplicate: true }
4. Parse JSON do body (se falhar → 400 + log)
5. SE event === 'webhook.test':
   a) Resolve tenant via data.products[0].id (Offer lookup) OU data.tracking.src
   b) Busca Offer.visWebhookSecret (Offer do data.products[0].id; se null, o primeiro produto com secret)
   c) Valida HMAC-V1 com secret
   d) Se inválido → 401 + log de incidente
   e) Log em EventLog (type=webhook.test.received)
   f) Marca delivery.processed=true
   g) Retorna 200 { ok: true, event: 'webhook.test', message: 'Test received and validated' }
   h) FIM (não provisiona)
6. Resolve tenant:
   a) Lê data.tracking.src
   b) Se formato "tenant_<slug>" → busca Tenant por slug
   c) Senão, busca Offer por data.products[0].id → tenant
   d) Se nenhum resolve → 400 + log + alerta
7. Busca Offer.visWebhookSecret (Offer do data.products[0].id; se null, o primeiro produto do array com secret; se nenhum → 401)
8. Valida X-Webhook-Signature-V1 com secret e raw body
   - Se inválido → 401 + log + alerta
9. Roteia por event:
   - order.approved → provision(...)
   - order.refunded → suspend(..., reason='refund')
   - order.chargedback → suspend(..., reason='chargeback') + alerta
   - order.cancelled → suspend(..., reason='cancelled')
   - order.refused → mark_refused(...)
   - order.created → mark_created(...) sem provisionar
   - subscription.* → log only em Fase 1
   - access.granted / access.revoked → log only em Fase 1
10. Marca delivery.processed=true
11. Retorna 200
```

### Função `provision(data, tenant)` — escopo da Fase 1.3b

```
1. INICIA TRANSAÇÃO
2. UPSERT User WHERE (tenantId, email)
3. UPSERT Order WHERE visOrderId
   - se já APPROVED → return (idempotência)
   - se PENDING/CREATED → atualiza pra APPROVED
   - se não existe → cria
4. Para cada produto em data.products[]:
   - Busca Offer por visProductId
   - Se não existe → log de erro + NÃO falha o webhook (continua processando o resto)
   - INSERT OrderItem (orderId, offerId, productId, isBump=false, unitPrice, quantity)
5. Calcula entitlements a criar:
   - Para cada Offer dos OrderItems, busca OfferProducts
   - Para cada (User, Product) único:
     - INSERT Entitlement (sourceOrderId, status=ACTIVE, expiresAt baseado em validityDays)
6. Gera AccessToken (UUID, expiresAt=now+15min)
7. Marca Order.provisioned=true, provisionedAt=now
8. COMMIT TRANSAÇÃO
9. Dispara (FORA da transação, ASSÍNCRONO):
   - WhatsApp com link de acesso (fila)
   - Email com link de acesso (fila)
10. EventLog: order.provisioned
```

### Tratamento de produto desconhecido

Se `data.products[].id` não tem `Offer` correspondente no banco:
- Loga em `EventLog` (level=error, type=`webhook.unknown_product`)
- Notifica admin (canal Slack/email interno futuro)
- **Continua processando o resto** (não falha o webhook todo por causa de um item)
- Retorna 200 pra VIS (não adianta retentar — falta dado nosso)

---

## 9. Página de obrigado + polling

### URL configurada na VIS
```
https://app.<tenant>.com.br/obrigado?order_id={{order_id}}&email={{email}}
```

(Se a VIS não suportar templates, alternativa: usar parâmetros default que a VIS adicione, ou descobrir order via email+cookie temporário.)

### Comportamento
1. Página renderiza UI de "estamos liberando seu acesso..."
2. JS faz `GET /api/orders/status?order_id=X&email=Y` a cada 2s
3. Endpoint retorna:
   - `{ status: 'pending' }` se Order não existe ou `provisioned=false`
   - `{ status: 'ready', accessToken: 'uuid', redirectUrl: '/auth/redeem?t=uuid' }` se pronto
   - `{ status: 'failed', reason: 'refused|cancelled|...' }` se Order virou status terminal sem provisionar
4. Quando `ready`: redireciona automaticamente pra `redirectUrl`
5. Após 60s sem sucesso: mostra "enviamos o link no seu WhatsApp e email" + botão pra reenviar

### Endpoint `/api/orders/status`
- Rate limit: 30 req/min/IP
- Não exige autenticação (cliente ainda não logou)
- Valida que `email` matches a `Order.user.email` (não vaza order pra qualquer email)
- Reusa AccessToken já gerado no provisionamento. Se já expirou (>15min), gera novo.

---

## 10. Ambiente de testes

### Em desenvolvimento local

Estratégia híbrida:

**A) Testes unitários e integração (vitest):** geram payloads sintéticos e calculam HMAC com um secret de teste. NÃO precisa da VIS real. Cobre 90% dos casos.

**B) Endpoint `/api/webhooks/vis/simulate`** (gated por `ENABLE_WEBHOOK_SIMULATOR=true`):
- Aceita payloads completos OU presets ("approved", "refunded", "webhook.test", etc.)
- NÃO valida HMAC (é dev, é endpoint separado)
- Permite testar provisionamento sem VIS

**C) Botão "Testar Webhook" no painel VIS** (uma vez configurado o produto DEV):
- Dispara `webhook.test` contra a URL configurada
- Útil pra testar HMAC real com payload real do Mateus
- Útil pra validar que o tunnel (ngrok) está OK

### Em staging/preview
- Conecta na VIS real, usando o **produto DEV** (Missa Explicada DEV) que o Mateus vai criar
- Webhook real, HMAC real, mas dados de teste

### Em produção (Fase 1.7+)
- Múltiplos webhooks por produto (Mateus implementa)
- Produto 20 (Missa Explicada real) dispara webhook PARA AMBOS: vis-dashboard E app de membros
- Sem conflito

---

## 11. Logs e auditoria

Toda chegada de webhook é logada em **3 lugares**:

1. **`WebhookDelivery`** — registro técnico (raw payload, hash, headers, validação)
2. **`EventLog`** — eventos de negócio derivados (order.provisioned, entitlement.granted, etc.)
3. **Sentry** — só erros (signature inválida, produto desconhecido, falha de provisionamento)

### Campos auditáveis críticos
- Quem (qual tenant)
- Quando (paid_at, processedAt)
- O quê (visOrderId, products, amount)
- Resultado (provisionado? entitlements criados? notificações enviadas?)

---

## 12. Pendências do lado VIS

### ✅ Concluídas (Fase 0)
- Botão "Testar Webhook" no painel VIS — **PRONTO**
- Confirmação do contrato com `src` (documentado em código) — **PRONTO**
- Correção do bug `order.chargedback` separado de `order.refunded` — **PRONTO**

### 🔄 Pendente para Fase 1
- **Criar produto DEV** ("Missa Explicada DEV") com webhook apontando pro app de membros — bloqueia testes de integração real (mas não bloqueia 1.3a)
- **Confirmar funcionamento real de `order.chargedback`** com transação real — não bloqueia, mas ideal validar quando possível

### 🔮 Pendente para Fase 1.7 (deploy em prod)
- **Implementar múltiplos webhooks por produto** (tabela `product_webhooks` 1-N) — Mateus se ofereceu a implementar
- Confirmar se `thank_you_url` suporta placeholders dinâmicos (`{{order_id}}`, `{{email}}`)

### 🔮 Pendente para Fase 2+
- Flag `is_bump` no array `products[]`
- Campo `metadata` livre no checkout (mais flexível que `src`/`sck`)
- Esclarecer eventos `access.granted` / `access.revoked`
- Modelar reembolso parcial (se virar necessidade)

---

## 13. Contrato de versionamento

### Mudanças aditivas (seguras, sem versão nova)
- Adicionar campo novo no payload
- Adicionar evento novo (que ignoramos até implementar)
- Adicionar header novo
- Adicionar query param novo nas URLs

### Mudanças que exigem nova versão do contrato (3.0)
- Renomear campo existente
- Mudar tipo de campo
- Remover campo
- Mudar formato de assinatura
- Mudar significado de status

### Processo de mudança quebrável
1. Mateus avisa com 30 dias de antecedência
2. Documentamos neste documento com data de corte
3. Implementamos suporte às duas versões em paralelo
4. Após data de corte, remove suporte ao antigo
