# WEBHOOK_CONTRACT.md — Integração VIS Platform ↔ Plataforma de Membros

> **Documento de contrato.** Define exatamente como a Plataforma de Membros consome webhooks da VIS Platform. Toda mudança no contrato é deliberada e versionada. Mudanças do lado VIS devem ser aditivas (nunca quebrar campos existentes).

> **Versão:** 1.0 • **Última atualização:** Maio/2026 • **Aplica-se a:** Fases 1-3 do roadmap

---

## 1. Visão geral da integração

A integração tem **três pontos de contato** entre VIS e Plataforma de Membros:

1. **URL de checkout** — link onde o cliente compra. Carrega `?src=tenant_<slug>` pra identificar o tenant.
2. **Webhook outbound (VIS → Membros)** — VIS notifica eventos de pedido/pagamento.
3. **Página de obrigado + polling** — após pagamento, cliente é redirecionado pra `thank_you_url` (página HOSPEDADA no app de membros), que faz polling pra detectar quando provisionamento concluiu.

**Importante:** o redirect e o webhook são **caminhos independentes**. O sistema é resiliente a qualquer ordem ou atraso entre os dois.

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

## 2. URLs de checkout

### Formato canônico
```
https://checkout.visplatform.com/produto/<slug-do-produto>?src=tenant_<slug-tenant>
```

### Por que `src`?
A VIS não tem campo `metadata` livre no checkout, mas tem `src` (e `sck`) que vêm no `tracking` do webhook. Usamos `src` como canal oficial pra passar `tenantId`.

**Convenção:** `src` SEMPRE no formato `tenant_<slug-tenant>` para uso da Plataforma de Membros. Outros usos de `src` (UTM tradicional, etc) NÃO devem colidir com esse prefixo. Se necessário, validar regex `^tenant_[a-z0-9-]+$`.

### Fallback se `src` ausente
Se um link de checkout for compartilhado sem `src`, o webhook chega sem ele. **Fallback:** o serviço resolve o tenant via `Offer.visProductId` → `Offer.tenantId`. Cada produto VIS pertence a UM tenant nosso (constraint do banco), então a resolução é determinística.

### Convenções por tenant
| Tenant | Slug | Prefixo `src` |
|--------|------|----------------|
| Missa Explicada | `missa-explicada` | `tenant_missa-explicada` |
| Templo Revelado | `templo-revelado` | `tenant_templo-revelado` |
| Protocolo Alpha | `protocolo-alpha` | `tenant_protocolo-alpha` |

---

## 3. Configuração do webhook na VIS

Para cada produto na VIS, configurar:

| Campo | Valor |
|-------|-------|
| `webhook_url` | `https://app.<dominio-do-tenant>.com.br/api/webhooks/vis` |
| `webhook_secret` | gerado pela VIS, armazenado em `Tenant.visWebhookSecret` (banco do app de membros) |
| `thank_you_url` | `https://app.<dominio-do-tenant>.com.br/obrigado?order_id={{order_id}}&email={{email}}` |

**Pergunta a confirmar com Mateus:** a `thank_you_url` aceita placeholders dinâmicos como `{{order_id}}` e `{{email}}` no momento do redirect? Se sim, o polling fica trivial. Se não, o backend descobre via email do usuário logado/cookie. Documentar a resposta neste documento.

---

## 4. Payload do webhook (eventos de pedido)

### Headers obrigatórios
```
Content-Type: application/json
User-Agent: VIS-Platform-Webhook/1.0
X-Webhook-Event: order.approved | order.refunded | ...
X-Webhook-Product-Id: 20
X-Webhook-Delivery-Id: <uuid>
X-Webhook-Signature: <hmac-sha256-do-body>
X-Webhook-Signature-V1: t=<unix-ts>,v1=<hmac-sha256-de-(ts.body)>
```

### Validação de assinatura

**Preferimos sempre `X-Webhook-Signature-V1`** (com timestamp, previne replay). O fallback para `X-Webhook-Signature` simples é aceito mas logado como aviso.

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

  // 1. Idade
  const ageSec = Math.floor(Date.now() / 1000) - ts;
  if (ageSec > maxAgeSec || ageSec < -30) return false;

  // 2. Assinatura
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');

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
      {
        "id": 20,
        "name": "Missa Explicada",
        "quantity": 1,
        "price": 197.00
      }
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
      "browser": null,
      "os": null,
      "country": null,
      "region": null,
      "city": null
    },
    "created_at": "2026-05-17T14:28:00-03:00",
    "paid_at": "2026-05-17T14:30:00-03:00",
    "refunded_at": null
  }
}
```

### Campos que CONSUMIMOS
| Campo | Uso |
|-------|-----|
| `event` | Roteamento do handler |
| `data.order_id` | `Order.visOrderId` (idempotência forte) |
| `data.uuid` | `Order.visOrderUuid` (backup) |
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
| `data.products[].id` | `Offer.visProductId` (lookup) |
| `data.tracking.src` | Resolução de tenant (primary) |
| `data.tracking.utm_*` | Replicado em `Order.utm*` |
| `data.tracking.fbclid` / `gclid` / `ttclid` / `click_id` | Replicado em `Order.*` |
| `data.paid_at` | `Order.paidAt` |
| `data.refunded_at` | `Order.refundedAt` (em events de refund) |
| `data.created_at` | comparação com `Order.createdAt` |

### Campos que NÃO consumimos hoje (mas armazenamos em EventLog)
- `data.payment_id` — sensível, não armazenar em Order. Útil pra diagnóstico se Mateus precisar correlacionar.
- `data.tracking.ip_address`, `user_agent`, `referrer_domain` — armazenar em EventLog pra forense, não em Order.

### Variações por tipo de evento

| `event` | Diferença no payload | Ação |
|---------|---------------------|------|
| `order.created` | sem `paid_at` | cria Order com status PENDING, sem provisionar |
| `order.approved` | com `paid_at` | provisiona tudo |
| `order.refused` | com `status: refused` | marca Order como REFUSED, sem provisionar |
| `order.cancelled` | com `status: cancelled` | marca Order como CANCELLED, suspende entitlements |
| `order.refunded` | com `refunded_at` | suspende entitlements (SUSPENDED) |
| `order.chargedback` | similar a refunded | suspende entitlements (SUSPENDED) |
| `subscription.*` | estrutura diferente — escopo futuro | log apenas, não processa em V1 |
| `access.granted` / `access.revoked` | **A CONFIRMAR COM MATEUS** | log apenas, não processa em V1 |

---

## 5. Retry e idempotência

### Política de retry da VIS
- Até **5 tentativas** por delivery
- Backoff: 1min → 5min → 30min → 2h → 24h
- Status `exhausted` após 5 falhas
- Timeout de cada request: 30s
- VIS considera sucesso: HTTP 2xx

### Como nosso webhook lida com retry
1. Sempre retornar 2xx o mais rápido possível.
2. Validação (HMAC, formato) → 401/400 (não retentar — está quebrado)
3. Processamento OK → 200
4. Erro transitório (banco fora, fila cheia) → 500 (deixa retentar)
5. Erro permanente no processamento (dados inconsistentes) → 200 + log de erro + alerta interno (não adianta retentar)

### Idempotência (3 camadas)
1. **Por `visOrderId` único** em `Order` — não cria duas Orders pra mesma compra
2. **Por `payloadHash` único** em `WebhookDelivery` — não processa dois webhooks idênticos
3. **Por `visDeliveryId`** (header) — não processa duas vezes o mesmo delivery, mesmo se payload variar

### Processamento idempotente
```typescript
async function handleWebhook(rawBody: string, headers: WebhookHeaders) {
  // 1. Sempre cria o WebhookDelivery primeiro (auditoria)
  const payloadHash = sha256(rawBody);
  const delivery = await prisma.webhookDelivery.upsert({
    where: { payloadHash },
    create: { /* ... */ processed: false },
    update: {}, // se já existe, não muda
  });

  if (delivery.processed) {
    return { ok: true, message: 'already processed' };
  }

  // 2. Valida HMAC
  // 3. Processa em transação atômica (Order, User, Entitlements, AccessToken)
  // 4. Marca delivery.processed = true
}
```

---

## 6. Mapeamento de eventos → ações

| Evento VIS | Ação no app de membros |
|------------|------------------------|
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
| `access.granted` | **A confirmar** com Mateus |
| `access.revoked` | **A confirmar** com Mateus |

---

## 7. Endpoint do webhook — comportamento detalhado

```
POST /api/webhooks/vis
```

### Algoritmo

```
1. Lê headers e raw body (sem parsear ainda)
2. Calcula payloadHash = sha256(rawBody)
3. UPSERT WebhookDelivery por payloadHash
   - Se já processed=true → 200 OK { duplicate: true }
4. Parse JSON do body (se falhar → 400 + log)
5. Resolve tenant:
   a) Lê data.tracking.src
   b) Se formato "tenant_<slug>" → busca Tenant por slug
   c) Senão, busca Offer por data.products[0].id → tenant
   d) Se nenhum resolve → 400 + log + alerta
6. Busca Tenant.visWebhookSecret
7. Valida X-Webhook-Signature-V1 com secret e raw body
   - Se inválido → 401 + log + alerta
8. Roteia por event:
   - order.approved → provision(...)
   - order.refunded → suspend(...)
   - ... etc
9. Marca delivery.processed=true
10. Retorna 200
```

### Função `provision(data, tenant)`

```
1. INICIA TRANSAÇÃO
2. UPSERT User WHERE (tenantId, email)
   - cria se não existe; atualiza nome/phone se mudou
3. UPSERT Order WHERE visOrderId
   - se já APPROVED → return (idempotência)
   - se PENDING/CREATED → atualiza pra APPROVED
   - se não existe → cria
4. Para cada produto em data.products[]:
   - Busca Offer por visProductId
   - Se não existe → ERRO (produto desconhecido) + log + alerta interno + NÃO falha o webhook
   - INSERT OrderItem (orderId, offerId, productId, isBump=false, unitPrice, quantity)
5. Calcula entitlements a criar:
   - Para cada Offer dos OrderItems, busca OfferProducts
   - Para cada (User, Product) único:
     - INSERT Entitlement (sourceOrderId, status=ACTIVE, expiresAt baseado em validityDays)
6. Gera AccessToken (UUID, expiresAt=now+15min)
7. Marca Order.provisioned=true, provisionedAt=now
8. COMMIT TRANSAÇÃO
9. Dispara (fora da transação):
   - WhatsApp com link de acesso
   - Email com link de acesso
   - Push (se já tiver subscription do user — caso de re-compra)
10. EventLog: order.provisioned
```

### Tratamento de produto desconhecido

Se `data.products[].id` não tem `Offer` correspondente no banco:
- Loga em `EventLog` (level=error, type=`webhook.unknown_product`)
- Notifica admin (canal Slack/email interno)
- **Continua processando o resto** (não falha o webhook todo por causa de um item)
- Retorna 200 pra VIS (não adianta retentar — falta dado nosso)

Isso é importante: nunca deixar o webhook falhar por dado faltando NO NOSSO LADO. A VIS já fez sua parte.

---

## 8. Página de obrigado + polling

### URL configurada na VIS
```
https://app.<tenant>.com.br/obrigado?order_id={{order_id}}&email={{email}}
```

(Se a VIS não suportar templates, alternativa: `?vis_order_id=X` ou descobrir order via email+sessão temporária.)

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
- Rate limit: 30 req/min/IP (polling agressivo é OK, ataques não)
- Não exige autenticação (cliente ainda não logou)
- Valida que `email` matches a `Order.user.email` (não vaza order pra qualquer email)
- Gera AccessToken NOVO a cada chamada bem-sucedida? **NÃO.** Reusa o gerado no provisionamento. Se já expirou (>15min), gera novo.

---

## 9. Ambiente de testes (workarounds)

A VIS não tem sandbox isolado. Nossas estratégias:

### Em desenvolvimento local
- Endpoint `/api/webhooks/vis/simulate` (gated por `ENABLE_WEBHOOK_SIMULATOR=true`)
- Aceita payloads completos OU presets ("approved", "refunded", etc)
- NÃO valida HMAC (é dev)
- Permite testar provisionamento sem VIS

### Em staging/preview
- Conecta na VIS real
- Configura um produto de R$1 ou usa o `dispatchOrderEvent` admin da VIS pra reenviar eventos de pedidos reais antigos
- Webhook real, HMAC real

### Em produção
- Botão "testar webhook" no painel VIS — **AJUSTE PENDENTE NO LADO VIS** (alta prioridade)
- Enquanto não existe: usa transações de R$1 com cartão real

---

## 10. Logs e auditoria

Toda chegada de webhook é logada em **3 lugares**:

1. **`WebhookDelivery`** — registro técnico (raw payload, hash, headers, validação)
2. **`EventLog`** — eventos de negócio derivados (order.provisioned, entitlement.granted, ...)
3. **Sentry** — só erros (signature inválido, produto desconhecido, falha de provisionamento)

### Campos auditáveis críticos
- Quem (qual tenant)
- Quando (paid_at, processedAt)
- O quê (visOrderId, products, amount)
- Resultado (provisionado? entitlements criados? notificações enviadas?)

---

## 11. Mudanças pendentes no lado VIS

### Alta prioridade (antes da Fase 1)
1. **Botão "testar webhook"** no painel VIS — pra debug sem venda real
2. **Confirmar funcionamento de `order.refunded` e `order.chargedback`** — fazer um teste real fim-a-fim
3. **Documentar uso oficial de `src` como `tenantId`** — pra futuro time da VIS não remover acidentalmente

### Média prioridade (Fase 2-3)
4. **Flag `is_bump`** no array `products[]` — pra analytics
5. **Campo `metadata` livre** no checkout — mais flexível que `src`/`sck`
6. **Esclarecer eventos `access.granted` e `access.revoked`** — o que disparam? Quando?

### Baixa prioridade (Fase 5+)
7. Reembolso parcial — se virar necessidade
8. Webhook detalhado de subscriptions — quando esteira tiver recorrência

---

## 12. Contrato de versionamento

### Mudanças aditivas (seguras, sem versão nova)
- Adicionar campo novo no payload
- Adicionar evento novo (que ignoramos até implementar)
- Adicionar header novo
- Adicionar query param novo nas URLs

### Mudanças que exigem nova versão do contrato
- Renomear campo existente
- Mudar tipo de campo (Int → String, etc)
- Remover campo
- Mudar formato de assinatura
- Mudar significado de status

### Processo de mudança quebrável
1. Mateus avisa com 30 dias de antecedência
2. Documentamos em `WEBHOOK_CONTRACT.md` (este doc) com data de corte
3. Implementamos suporte às duas versões em paralelo
4. Após data de corte, remove suporte ao antigo

---

## 13. Perguntas em aberto (a confirmar com Mateus)

- [ ] A `thank_you_url` aceita placeholders dinâmicos (`{{order_id}}`, `{{email}}`)?
- [ ] Os eventos `access.granted` e `access.revoked` — o que disparam? Documentar.
- [ ] Quando vai implementar `is_bump` no payload?
- [ ] Quando vai implementar o botão "testar webhook" no painel?
- [ ] Tem como receber uma cópia dos eventos `subscription.*` pra logarmos desde já (mesmo sem processar) e estudarmos o formato?

Respostas dessas perguntas devem ser incorporadas neste documento à medida que chegarem.
