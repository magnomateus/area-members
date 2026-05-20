# PHASES.md — Roadmap de Implementação da Plataforma de Membros

> **Documento de planejamento.** Define cada fase do projeto com critérios de aceite, escopo, fora de escopo, dependências e definição de "pronto". Cada fase entrega VALOR REAL em produção. Nada de fases "preparatórias".

> **Versão:** 1.0 • **Última atualização:** Maio/2026

---

## Princípios do roadmap

1. **Cada fase entrega algo USÁVEL em produção.** Nada de "infra preparatória". Cada fase termina com clientes reais usando.
2. **Cada fase tem critérios de aceite verificáveis.** Não "tá funcionando", e sim "X clientes compraram e acessaram em Y minutos".
3. **Fase só termina quando o sistema rodar em produção COM CLIENTES PAGANTES.** Validação técnica não conta sozinha.
4. **Próxima fase só começa quando a anterior estiver estável.** Sem paralelismo. Foco extremo.
5. **Documento Claude Code = `ARCHITECTURE.md` + seção da fase atual.** Cada prompt referencia esses dois.

---

## Mapa geral das fases

| Fase | Nome | Entrega principal | Status |
|------|------|-------------------|--------|
| 0 | Pré-requisitos VIS | Ajustes do lado VIS antes de codar | Em andamento |
| 1 | MVP — Compra → Acesso (1 produto) | Cliente real compra Missa Explicada e baixa o PDF | Pendente |
| 2 | Multi-produto por oferta + Bônus + Comunidade | Oferta Premium libera múltiplos itens | Pendente |
| 3 | Esteira contextual (upsell na home) | Cards de "desbloqueie também" geram conversão | Pendente |
| 4 | PWA + Push Notifications | App instalável + reengajamento | Pendente |
| 5 | Admin dashboard | Magno e Mateus configuram tudo no painel | Pendente |
| 6 | Métricas de LTV | Dashboards de ativação, engajamento, upsell | Pendente |
| 7 | Segundo tenant + refinamentos | Protocolo Alpha entra como tenant + reivindicação de compras | Pendente |

---

## Fase 0 — Pré-requisitos VIS

**Por que existe:** algumas coisas só o Mateus pode fazer no lado VIS. Bloqueiam ou facilitam muito a Fase 1.

### Escopo
- Mateus implementa **botão "testar webhook"** no painel VIS
- Mateus confirma funcionamento de **`order.refunded` e `order.chargedback`** com transações reais
- Mateus documenta uso de **`src` como `tenantId`** no código da VIS (comentário no source ou docs internos)
- Mateus gera **webhook_secret** pro produto Missa Explicada e entrega ao Magno

### Critérios de aceite
- [ ] Magno consegue disparar webhook de teste do painel VIS sem precisar de venda real
- [ ] Magno tem evidência (log VIS) de que `order.refunded` foi disparado em uma transação real reembolsada
- [ ] Documentação interna VIS menciona `src` como uso reservado para tenantId
- [ ] Webhook secret está em mãos do Magno

### Fora de escopo
- Implementar `is_bump`, `metadata` livre, reembolso parcial — vão pra fases futuras

### Dependências
- Disponibilidade do Mateus

---

## Fase 1 — MVP de compra → acesso (1 produto)

**Por que existe:** validar a fundação do sistema (multi-tenant, webhook, entitlement, acesso) com o MENOR escopo possível. Se isso funciona, o resto é incremento. Se isso não funciona, nada do resto importa.

**Critério de sucesso humano:** o Mateus PARA de enviar PDF manualmente pra cada cliente que comprou Missa Explicada.

### Escopo
- 1 tenant configurado: Missa Explicada
- 1 Offer mapeada: Missa Explicada R$197 (ou preço atual) → libera 1 Product
- 1 Product: "Ebook Missa Explicada" com 1 ContentItem tipo PDF
- Webhook `/api/webhooks/vis` aceita `order.approved` e provisiona
- AccessToken gerado, link enviado por WhatsApp + email
- Página `/obrigado` com polling
- Página `/auth/redeem` consome token e cria sessão
- Home (`/home`) mostra o PDF disponível
- Página do produto (`/produtos/[slug]`) mostra ContentItems
- Endpoint `/api/content/[id]/signed-url` gera URL assinada (15min) do PDF no Supabase Storage
- Logout em `/conta`
- Magic link "esqueci o acesso" em `/login`
- **Layout mobile-first** mas funcional em desktop

### O que NÃO entra (intencionalmente)
- Outros tenants
- Múltiplos produtos por oferta
- Bônus, comunidade
- Upsell, cross-sell
- Push notifications
- PWA instalável (vem na Fase 4)
- Admin dashboard (CRUD via Prisma Studio + seed temporariamente)
- Reembolso/chargeback handler (estrutura preparada, mas não testado em prod)

### Sub-fases (prompts separados pro Claude Code)

#### 1.1 — Bootstrap do projeto e schema
**Prompt CC fará:** Next.js 16 + Prisma + Lucia + estrutura de pastas + schema Prisma completo (todas as tabelas, mesmo as que só serão usadas em fases futuras — schema unificado desde o início) + migrations rodadas em dev + seed do tenant Missa Explicada.

**Aceite:**
- [ ] `pnpm dev` sobe sem erro
- [ ] Tenant Missa Explicada visível no Prisma Studio
- [ ] Offer + Product + ContentItem (fake mas estruturados) visíveis

#### 1.2 — Proxy multi-tenant + autenticação base
**Prompt CC fará:** proxy (`proxy.ts`) que resolve tenant por domínio (em dev usa `DEV_TENANT_SLUG`), `AsyncLocalStorage` pra propagar tenantId, helper `scoped-db.ts`, integração Lucia, página `/login` (UI mobile-first, magic link request).

**Aceite:**
- [ ] Em dev, `localhost:3000` resolve para tenant Missa Explicada (via header ou env)
- [ ] Página `/login` renderiza com branding do tenant
- [ ] Magic link gera AccessToken (sem enviar email ainda, só ver no banco)

#### 1.3 — Webhook handler completo
**Prompt CC fará:** `POST /api/webhooks/vis` com validação HMAC-V1, idempotência via WebhookDelivery, resolução de tenant, função `provision()` em transação atômica criando User+Order+OrderItems+Entitlements+AccessToken, log em EventLog. Testes unitários do signature, idempotência, provisionamento. Endpoint `/api/webhooks/vis/simulate` em dev.

**Aceite:**
- [ ] Disparar payload de exemplo via `/simulate` → cria tudo no banco corretamente
- [ ] Disparar 2x mesmo payload → não duplica
- [ ] Payload com signature inválida → 401, nada criado
- [ ] Payload com tenant não resolvível → 400, log de erro
- [ ] Testes passando

#### 1.4 — Página de obrigado + polling + redeem
**Prompt CC fará:** página `/obrigado` com UI de loading, JS de polling em `/api/orders/status`, página `/auth/redeem` que consome AccessToken e cria sessão, fallback "enviamos link no WhatsApp" após 60s.

**Aceite:**
- [ ] Acessar `/obrigado?order_id=X` → fica em loading, polling em background
- [ ] Quando provisionamento concluir → redireciona pra `/auth/redeem?t=...` automaticamente
- [ ] Redeem cria sessão e leva pra `/home`
- [ ] Token expirado → tela de erro com botão "reenviar link"

#### 1.5 — Home + página do produto + signed URL do PDF
**Prompt CC fará:** layout do (member) shell mobile-first, página `/home` lista Products com entitlement ACTIVE, página `/produtos/[slug]` lista ContentItems, botão de download chama `/api/content/[id]/signed-url` que valida `hasAccess` e gera URL Supabase Storage de 15min.

**Aceite:**
- [ ] User logado vê na home apenas Products com entitlement ACTIVE
- [ ] Página do Product mostra ContentItems ordenados por sortOrder
- [ ] Clicar em PDF abre/baixa via signed URL
- [ ] User sem entitlement → 403 ao tentar `/produtos/[slug]` ou signed-url
- [ ] PDF aberto via URL direta (sem signed) → não funciona

#### 1.6 — Notificações: WhatsApp + email
**Prompt CC fará:** integração Evolution API (WhatsApp) e Resend (email), templates por tenant, dispara durante provisionamento, fila simples in-process com retry.

**Aceite:**
- [ ] Compra real (ou simulada) dispara WhatsApp e email com link
- [ ] Link no WhatsApp funciona em celular Android e iOS
- [ ] Email cai na caixa de entrada (não spam) — domínio configurado com SPF/DKIM
- [ ] Falha de envio → retry 3x, depois log de erro

#### 1.7 — Deploy em produção + primeiro cliente real
**Prompt CC fará:** configurar Vercel, Supabase prod, env vars, DNS de `app.missaexplicada.com.br`, smoke tests, conectar webhook real na VIS.

**Aceite (essa é a fase mais importante):**
- [ ] Cliente real compra Missa Explicada na VIS
- [ ] Recebe link no WhatsApp em menos de 2 minutos
- [ ] Acessa, baixa o PDF
- [ ] Mateus NÃO precisa intervir
- [ ] Pelo menos 5 clientes reais usando a área antes de iniciar Fase 2

### Métrica-guia da Fase 1
**Tempo médio entre `paid_at` e `accessToken.usedAt`** abaixo de 5 minutos para 80% dos clientes.

---

## Fase 2 — Multi-produto por oferta + Bônus + Comunidade

**Por que existe:** Missa Explicada não é só ebook. Tem 5 bônus, link de comunidade, etc. A oferta premium libera múltiplas coisas.

### Escopo
- Suporte completo a `OfferProduct[]` no provisionamento (uma Offer libera N Products)
- ContentItem tipo `EXTERNAL_LINK` (comunidade WhatsApp/Telegram)
- ContentItem tipo `BONUS_PACK` (subgrupo de PDFs bônus)
- Página do produto suporta múltiplos ContentItems organizados em seções
- Validade configurável por `OfferProduct.validityDays` aplicada no provisionamento

### Sub-fases sugeridas

#### 2.1 — Provisionamento multi-produto
Webhook handler atualizado pra criar N entitlements por Offer, respeitando `OfferProduct.validityDays`.

#### 2.2 — ContentItem tipo EXTERNAL_LINK
Render diferente na UI: card "entrar na comunidade" → abre WhatsApp/Telegram em nova aba. Tracking de clique em Progress.

#### 2.3 — Layout de produto com múltiplos ContentItems
Seções: "Conteúdo principal", "Bônus", "Comunidade". Ordenação por sortOrder. Estados visuais (consumido/não consumido).

#### 2.4 — Onboarding do tenant Missa Explicada com TODOS os produtos
Via seed ou Prisma Studio (admin ainda na Fase 5). Configurar Offer Premium, Offer Básica, todos os Products, ContentItems.

### Critérios de aceite
- [ ] Cliente que compra Offer Premium recebe acesso a ebook + 5 bônus + comunidade
- [ ] Cliente que compra Offer Básica recebe acesso só ao ebook
- [ ] Link da comunidade funciona em mobile
- [ ] Tempo médio até primeiro acesso da comunidade (D7) > 60% dos compradores

---

## Fase 3 — Esteira contextual (upsell na home)

**Por que existe:** o coração do objetivo do projeto. Aumentar LTV mostrando o que o cliente AINDA NÃO TEM.

### Escopo
- Home tem duas seções: "Seus produtos" e "Desbloqueie também"
- "Desbloqueie também" lista Products do tenant que o User NÃO tem entitlement
- Cada card de upsell tem CTA → link de checkout VIS com `?src=tenant_<slug>`
- Tracking de impressões e cliques em EventLog
- Lógica de priorização (qual oferecer primeiro): por enquanto, ordem manual (sortOrder)
- Banner de boas-vindas no primeiro acesso (acabou de comprar)
- Página "obrigado"  pode também já mostrar 1 oferta de upsell (carrossel, soft)

### Critérios de aceite
- [ ] User que comprou ebook básico vê na home cards de "App Premium", "Templo Revelado", etc
- [ ] Click no card abre checkout VIS no produto certo
- [ ] CTR de upsell ≥ 5% dos clientes ativos
- [ ] Conversão de upsell ≥ 2% dos cliques (cliente fecha compra)

---

## Fase 4 — PWA + Push Notifications

**Por que existe:** segundo motor de reengajamento. Cliente instala como app, recebe notificação, volta.

### Escopo
- Manifest PWA dinâmico por tenant (`/app/manifest.ts`)
- Service worker com cache estratégico
- Banner "Instalar como app" inteligente (não invasivo, mostra na 2ª sessão)
- Permissão de push solicitada no momento certo (após primeira interação positiva, não no login)
- Endpoint `/api/push/subscribe` e `/vapid-key`
- Templates de push:
  - "Você ainda não acessou seu bônus" (após 3 dias sem progress)
  - "Nova oferta disponível pra você" (manual ou automatizado)
- Throttling: max 2 push/semana/user
- Opt-out fácil em `/conta`

### Critérios de aceite
- [ ] App instalável no iOS 16.4+ e Android
- [ ] ≥ 30% dos usuários aceitam push
- [ ] Push de "bônus não acessado" gera ≥ 20% de retorno ao app
- [ ] Zero reclamações de "spam" no suporte

---

## Fase 5 — Admin dashboard

**Por que existe:** até aqui, Magno/Mateus configuram via Prisma Studio. Insustentável. Precisam de UI.

### Escopo
- Rotas `/admin` com auth especial (role-based)
- CRUD de Tenant (criar, editar branding)
- CRUD de Offer (criar, mapear `visProductId`, definir `OfferProducts` e `validityDays`)
- CRUD de Product (criar, definir tipo, sortOrder)
- CRUD de ContentItem (upload de PDF pra Supabase Storage, link externo, etc)
- Listagem de Users com filtros (tenant, data, status)
- Listagem de Orders com filtros e detalhes
- Botão "suspender acesso manualmente" em Entitlement
- Botão "reativar acesso"
- Botão "reenviar magic link" pro user
- Visualização de WebhookDelivery (debug)
- Visualização de EventLog
- Templates de notificações editáveis

### Critérios de aceite
- [ ] Magno configura novo produto inteiro (Offer + Products + ContentItems) sem mexer no banco
- [ ] Magno consegue diagnosticar webhook que falhou olhando o dashboard
- [ ] Magno suspende acesso de um cliente em < 30s

---

## Fase 6 — Métricas de LTV

**Por que existe:** sem medir, não tem como otimizar. E o projeto inteiro foi feito pra aumentar LTV.

### Escopo
- Dashboard `/admin/metricas` com:
  - **Ativação:** % de Orders com token usado em 24h, gráfico semanal
  - **Engajamento D1:** % com ≥1 content.accessed em 24h
  - **Engajamento D7:** % com ≥1 content.accessed em 7 dias
  - **Upsell impressions/clicks/conversions** por Product
  - **Tempo médio até 2ª compra** (mediana)
  - **% de clientes com 2+ compras** (multi-compradores)
  - **LTV médio por tenant** (soma de Order.amount / count(User))
  - **Funil:** comprou → logou → consumiu → comprou de novo
- Export CSV de qualquer relatório
- Filtros por data, tenant, oferta

### Critérios de aceite
- [ ] Magno consegue responder em < 30s: "qual o LTV médio dos clientes Missa Explicada?"
- [ ] Magno identifica o produto da esteira que mais converte upsell
- [ ] Dados consistentes com EventLog (validação cruzada)

---

## Fase 7 — Segundo tenant + refinamentos

**Por que existe:** validar que multi-tenancy realmente funciona com tenant DIFERENTE. E adicionar features que só fazem sentido com base estável.

### Escopo
- Tenant Protocolo Alpha (ou outro) ativado em produção
- Domínio `app.protocoloalpha.com.br` apontando pra Vercel
- Branding completo (logo, cores, nome) sem deploy novo
- **Reivindicação de compras antigas:** user com email A consegue provar que email B é dele (via OTP no email novo) e unificar acesso
- Suporte a "perguntar email diferente do checkout" se necessário (Mateus comprou pro pai)
- Refinamentos de UX baseados em feedback real
- Performance: revisão de queries N+1, índices, caching

### Critérios de aceite
- [ ] Cliente do Tenant A NUNCA recebe push, email, ou vê dado do Tenant B
- [ ] Dois tenants em produção rodando simultaneamente sem incidente
- [ ] Reivindicação de compra antiga funciona em < 3 minutos pro cliente
- [ ] p95 de qualquer página < 1.5s

---

## Como cada prompt do Claude Code deve ser estruturado

### Template

```
CONTEXTO:
Você está implementando a Fase X, Sub-fase Y, do projeto Plataforma de Membros VIS.
Consulte sempre o ARCHITECTURE.md (constituição do projeto) e este PHASES.md.

FASE ATUAL: [nome e número]
SUB-FASE ATUAL: [nome e número]

OBJETIVO ESPECÍFICO DESTA SUB-FASE:
[copiar do PHASES.md]

CRITÉRIOS DE ACEITE:
[copiar checklist do PHASES.md]

CONTEXTO TÉCNICO RELEVANTE:
[colar trechos relevantes do ARCHITECTURE.md, ex: schema, fluxo, regras]

REGRAS DURAS:
- [listar regras específicas pra essa sub-fase, ex: "nunca skip HMAC validation"]

ENTREGAS:
- Código completo, com tipos, sem TODOs
- Testes para os caminhos críticos
- README ou comentários onde necessário
- Lista final dos critérios de aceite, marcando os atendidos

NÃO FAÇA:
- [listar coisas explicitamente fora do escopo]
```

### Critério "definição de pronto" universal

Uma sub-fase só está pronta quando:
1. ✅ Código tipado, sem `any`, sem TODOs pendentes
2. ✅ Testes passando (unitários + integração das partes críticas)
3. ✅ Lint e formatação OK
4. ✅ Todos os critérios de aceite checados manualmente
5. ✅ EventLog gravando os eventos relevantes
6. ✅ Erros tratados graciosamente, sem 500 em fluxo de produção
7. ✅ Magno revisou pelo menos uma vez

---

## Riscos transversais a monitorar em todas as fases

| Risco | Mitigação |
|-------|-----------|
| Vazamento de dado entre tenants | Testes E2E de isolamento em CI |
| Webhook duplicado processando 2x | Idempotência tripla (visOrderId, payloadHash, deliveryId) |
| AccessToken vazando em logs/email | Nunca logar token; em emails, só URL completa |
| Cliente perde acesso por bug | Sempre prefer SUSPEND em vez de DELETE; log audita tudo |
| VIS muda contrato sem aviso | EventLog mantém raw payload; testes de contrato em CI |
| Dependência exclusiva do polling | Triplo fallback (polling + WhatsApp + email) |
| Magno trava no launch da Fase 1 | Fase 1 deliberadamente MÍNIMA; deploy logo, refina depois |

---

## Definição final de sucesso do projeto

Em 6 meses contados da Fase 1 em produção:
- 2 tenants ativos
- Pelo menos 500 clientes únicos consumindo
- LTV médio 30% maior comparado ao período pré-projeto
- Mateus parou de operar manualmente entrega de produtos digitais
- Plataforma estável o suficiente pra ser oferecida como feature da VIS pra outros produtores

Se isso for atingido, o projeto cumpriu o que se propôs.
