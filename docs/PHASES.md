# PHASES.md — Roadmap da Plataforma de Membros VIS

> **Documento de planejamento e governança.** Define cada fase do projeto com 
> critérios de aceite, escopo, dependências, "definição de pronto" e ordem de 
> execução. Cada fase entrega valor real em produção.
> 
> **Versão:** 2.0 • **Última atualização:** Maio/2026 • **Cliente alvo:** 
> Magno Bessa (Grupo 3RN / Missa Explicada)

---

## Princípios refundados (v2)

### Princípio 1 — Plataforma de alto nível, não MVP

O Magno **já vende Missa Explicada** com R$100k+ em receita validada. Esta 
plataforma **não é validação de mercado** — é **migração de entrega** de um 
produto que já tem demanda comprovada para uma área de membros própria.

Implicações:
- **Qualidade > velocidade extrema.** Cliente pagante R$197 espera plataforma 
  de qualidade Stripe/Notion, não MVP travado.
- **Operação interna importa.** Admin Dashboard não é "feature secundária" — 
  é ferramenta de operação diária.
- **Lançar com base de clientes existente.** Migração planejada, não 
  "primeira venda".

### Princípio 2 — Cada fase entrega valor REAL em produção

Nenhuma fase é "preparatória". Cada fase termina com:
- Código em produção no GitHub
- Funcionalidade testada e demonstrável
- Critérios de aceite verificáveis
- Magno revisou e aprovou

### Princípio 3 — Próxima fase só começa quando a anterior está estável

Sem paralelismo. Foco extremo. Cada sub-fase tem:
- Prompt formal pro Claude Code
- Revisão do Magno
- Push autorizado
- Confirmação de testes verdes

### Princípio 4 — Documento Claude Code = ARCHITECTURE.md + seção da fase atual

Cada prompt referencia esses dois documentos como fonte da verdade.

### Princípio 5 — Decisão consciente, não automática

Todas as features deste roadmap foram decididas com análise explícita de 
trade-off. Mudanças no escopo exigem reabertura formal.

---

## Mapa geral das fases

| Fase | Nome | Status |
|------|------|--------|
| 0 | Pré-requisitos VIS | ✅ Concluído |
| 1.1-1.5 | MVP de compra → acesso (1 produto) | ✅ Em produção no GitHub |
| **5** | **Admin Dashboard (alto nível)** | 🟡 **Próxima** |
| 1.6 | Notificações WhatsApp + email reais (via admin) | ⏳ Após Fase 5 |
| 1.7 | Deploy em produção + primeiro cliente real | ⏳ Após Fase 1.6 |
| 2 | Multi-produto por oferta + Bônus | ⏳ Futura |
| 3 | Esteira contextual (upsell na home) | ⏳ Futura |
| 4 | PWA + Push Notifications | ⏳ Futura |
| 6 | Métricas de LTV avançadas | ⏳ Futura |
| 7 | Segundo tenant + refinamentos | ⏳ Futura |

**Mudança importante de ordem (v2):** Fase 5 (Admin) sobe pra ANTES de 1.6 
e 1.7. Razão: Magno é operador estabelecido (R$100k vendidos) que precisa 
de admin completo pra operar plataforma de alto nível, não MVP.

---

## Fases concluídas (1.1 → 1.5)

### ✅ Fase 1.1 — Bootstrap (commit 029c6ac)
Next.js 16 + Prisma + Lucia + estrutura de pastas + schema unificado + seed.

### ✅ Fase 1.2 — Proxy multi-tenant + auth base (commit 36df69b)
Proxy, AsyncLocalStorage, scoped-db, Lucia, /login com magic link.

### ✅ Fase 1.3a — Webhook handler core (commit b913a89)
POST /api/webhooks/vis com HMAC + idempotência + log.

### ✅ Fase 1.3b — Provisionamento (commit ff5724b)
Função provision() em transação atômica criando User+Order+OrderItems+
Entitlements+AccessToken.

### ✅ Fase 1.4 — Telas pós-compra (commit 5a89375)
/obrigado + polling + /auth/redeem + /home.

### ✅ Fase 1.5 — Página do produto + signed URL PDF (commit 0ff2ee5)
/produtos/[slug] + download de PDF via Supabase Storage signed URL 15min.

### ✅ Ajuste pré-Fase 5 (commit 83e2b71)
Seed atualizado: Comunidade WhatsApp deletada, Bônus PDFs desativado 
(será cadastrado via admin), filtro de active=true na home.

### ✅ Housekeeping (commit 8f02178)
.gitignore do scripts/ + documentação do helper de EventLog no RUNBOOK.

---

## Fase 5 — Admin Dashboard (próxima)

**Por que esta fase existe agora:** Magno opera Missa Explicada com R$100k+ 
em vendas. A entrega via plataforma própria exige admin completo: gestão de 
produtos, vendas, clientes, templates de notificação, observability e 
métricas. Sem admin, gerenciar 11 produtos da família Missa Explicada 
via Prisma Studio é insustentável.

**Critério de sucesso humano:** Magno administra todo o catálogo, vendas, 
clientes e operação pelo painel `/admin`, sem precisar mexer em código 
ou SQL para operações cotidianas.

### Estado externo: dependência do Mateus (VIS)

Mateus implementa endpoint público na VIS pra validação em tempo real do 
visProductId:
- Endpoint: `GET /api/v1/products/:id`
- Auth: Bearer API key com scope `products:read`
- Resposta: `{ id, name, active, currency, created_at }`
- Estimativa Mateus: 3-4 dias úteis
- **Bloqueio:** Sub-fase 5.1 (Offers) depende desse endpoint estar pronto

### Escopo decidido (Caminho 1 — plataforma total)

**Layout (decidido — Bloco 1):**
- Sidebar fixa à esquerda (estilo Linear/Vercel)
- Desktop-first, mobile bônus (responsivo mas otimizado pra desktop)
- Tema claro único
- shadcn/ui (compatível com Tailwind v3 — ADR 003 nova)

**Gestão de Conteúdo (decidido — Bloco 2A):**
- CRUD completo de Products
- CRUD completo de ContentItems (PDF, áudio, vídeo)
- Drag-and-drop pra reordenação de Products e ContentItems
- Upload com drag-and-drop + progress bar + preview de PDF
- WYSIWYG editor pra descrições

**Vendas e Clientes (decidido — Bloco 2B):**
- Tabela Orders completa com filtros (status, data, produto, tenant), 
  busca, paginação, ordenação, export CSV
- Página detalhe Order: dados do cliente, items, tracking UTM/fbclid, 
  entitlements gerados, EventLog daquela order, status do webhook
- Tabela Users completa com filtros (tenant, status, data, quantidade 
  de compras), busca por email/nome
- Página detalhe User: histórico de compras, entitlements ativos/expirados, 
  EventLog, tokens gerados, ações (suspender, reativar, reenviar magic link)

**Configurações (decidido — Bloco 2C):**
- Tenant: **fora desta fase** (continua via seed)
- Offers CRUD completo (criar, mapear visProductId, configurar status)
- OfferProducts: UI dedicada com drag-and-drop + configuração de validityDays
- visProductId: **validação em tempo real via API VIS** (Caminho A, Plano B 
  simplificado — só id+name+active+currency, sem price)

**Observability (decidido — Bloco 2D):**
- WebhookDelivery viewer: filtros por evento/status/tenant/data, JSON 
  viewer formatado, links pra Order/User, indicador visual de signature 
  OK/falha (**SEM full-text** no payload)
- Replay automático de webhook (botão pra reprocessar)
- EventLog viewer: filtros por tipo/level/tenant/usuário/Order, timeline 
  visual de eventos por Order (**SEM full-text**)
- Dashboard de saúde com gráficos: taxa de sucesso, latência média, top 
  erros nos últimos 7 dias

**Templates de Notificação (decidido — Bloco 2E):**
- CRUD completo de templates: criar/editar/duplicar por tipo (WhatsApp/
  email), por evento (compra aprovada, reembolso, magic link, etc), 
  com suporte a idiomas
- Editor markdown com preview lado a lado (não WYSIWYG, porque WhatsApp 
  não suporta imagens inline)
- Preview na UI + envio de teste real pra WhatsApp/email do admin
- Fila com retry automático 3x + Dead Letter Queue + monitoramento de 
  falhas no admin

**Auth e Roles (decidido — Bloco 3):**
- 2 admins: Magno + Mateus (ambos com permissão total)
- Login: Magic link + 2FA via Google Authenticator
- Roles binárias (Admin / não admin) — sistema preparado pra adicionar 
  roles diferenciadas no futuro sem refactor
- Audit log de ações críticas: suspender/reativar Entitlement, deletar/
  desativar Product/ContentItem, editar/publicar Template, alterar Offer, 
  reset de magic link/2FA, mudança de Tenant config

**Métricas (decidido — Bloco 4):**
- Dashboard de Vendas rico: gráfico de vendas no tempo, comparação de 
  períodos com variação %, breakdown por produto/oferta, top clientes, 
  exportação CSV
- Visões separadas para: Vendas, Ativação, Engajamento, Operacional
- Filtros completos: período (hoje/semana/mês/customizado), produto, 
  status, tenant futuramente
- Comparação de períodos: este mês vs mês passado, esta semana vs semana 
  passada, com variação %

### Sub-fases da Fase 5

#### Sub-fase 5.0 — Fundação do Admin (5-7 dias)

**Objetivo:** estabelecer fundação técnica do admin com auth, layout e 
audit log core.

**Escopo:**
- Setup do shadcn/ui (compatível com Tailwind v3) — ADR 003
- Rotas `/admin/*` com proteção por role
- Auth admin via magic link + 2FA Google Authenticator
- Layout admin: Sidebar fixa à esquerda + topbar + área de conteúdo
- Página `/admin/login` e `/admin/2fa`
- Página `/admin` (dashboard inicial, vazia por enquanto)
- Tabela `AdminUser` no schema (separada de User do cliente final)
- Tabela `AdminAuditLog` no schema
- Helper `logAdminAction()` registrando: adminId, action, entityType, 
  entityId, valoresBefore, valoresAfter, timestamp, ip, userAgent
- Middleware `requireAdmin()` em todas as rotas /admin

**Critérios de aceite:**
- [ ] Magno consegue logar em /admin/login com magic link + 2FA
- [ ] Layout renderiza com sidebar funcional (links pra Products, Orders, 
      Users, Templates, Métricas, Configurações, Observability — todos 
      ainda apontando pra páginas placeholder)
- [ ] Tentativa de acessar /admin sem login → redirect pra /admin/login
- [ ] User com role != admin → 403
- [ ] AdminAuditLog grava cada login (timestamp, ip, user-agent)
- [ ] Testes unitários do logAdminAction + middleware

#### Sub-fase 5.1 — Offers + OfferProducts (6-8 dias)

**Dependência:** endpoint VIS do Mateus pronto.

**Escopo:**
- Página `/admin/offers` com listagem
- Página `/admin/offers/new` e `/admin/offers/[id]/edit`
- CRUD completo de Offer
- Campo visProductId com validação em tempo real via API VIS
- UI dedicada de OfferProducts com drag-and-drop + dropdown de validityDays
- Audit log: criar/editar/desativar Offer e OfferProduct

**Critérios de aceite:**
- [ ] Magno cria uma Offer nova preenchendo visProductId, sistema valida 
      contra VIS e mostra nome do produto
- [ ] Erro de visProductId inválido → bloqueia salvamento + mensagem clara
- [ ] Magno arrasta Product pra dentro da Offer via drag-drop
- [ ] validityDays editável por OfferProduct
- [ ] Audit log registra cada criação/edição
- [ ] Testes de integração do CRUD e validação VIS

#### Sub-fase 5.2 — Products + ContentItems (7-9 dias)

**Escopo:**
- Página `/admin/products` com listagem (filtros, busca)
- CRUD completo de Product (criar, editar, desativar)
- WYSIWYG editor pra descrição (TipTap ou similar)
- Drag-and-drop pra reordenação de Products
- Sub-página `/admin/products/[id]/contents` pra gerenciar ContentItems
- Upload com drag-drop + progress bar + preview de PDF
- Suporte a tipos: PDF, áudio (MP3, OGG), vídeo (MP4, MOV), link externo
- Drag-and-drop pra reordenação de ContentItems
- Upload no Supabase Storage encapsulado em `src/lib/storage/` (ADR 002)
- Audit log: criar/editar/desativar Product/ContentItem

**Critérios de aceite:**
- [ ] Magno cria Product novo via UI sem mexer no banco
- [ ] Upload de PDF mostra progress bar + preview antes de salvar
- [ ] Magno arrasta items pra reordenar
- [ ] Descrição com formatação WYSIWYG funciona (negrito, itálico, 
      links, listas)
- [ ] Audit log registra cada ação crítica
- [ ] Cliente final acessa novo Product sem republicar código
- [ ] Testes E2E do upload completo

#### Sub-fase 5.3 — Users + Orders (7-9 dias)

**Escopo:**
- Página `/admin/users` com tabela completa (filtros: tenant, status, 
  data, qtd compras), busca, paginação, ordenação
- Página `/admin/users/[id]` com detalhes: histórico, entitlements, 
  EventLog, tokens
- Ações em User: suspender acesso, reativar, reenviar magic link
- Página `/admin/orders` com tabela completa (filtros: status, data, 
  produto, tenant), export CSV
- Página `/admin/orders/[id]` com detalhes: tracking UTM/fbclid, items, 
  entitlements, EventLog, webhook view
- Audit log: ações em User (suspender, reativar, reenviar)

**Critérios de aceite:**
- [ ] Magno encontra qualquer Order/User em < 10s via busca
- [ ] Magno suspende acesso de cliente em < 30s
- [ ] Export CSV de Orders funcional
- [ ] Detalhe de Order mostra UTM/fbclid se disponível
- [ ] Audit log de cada ação em User
- [ ] Testes E2E do fluxo de suspensão

#### Sub-fase 5.4 — Entitlements (2-3 dias)

**Escopo:**
- Página `/admin/entitlements` listando todos (filtros: status, user, 
  product, tenant)
- Ações: suspender, reativar
- Modal de confirmação com motivo (obrigatório)
- Audit log com motivo armazenado

**Critérios de aceite:**
- [ ] Magno suspende entitlement com motivo obrigatório
- [ ] Audit log mostra o motivo
- [ ] Cliente suspenso perde acesso imediatamente (hasAccess retorna false)
- [ ] Testes do fluxo de suspensão/reativação

#### Sub-fase 5.5 — Templates de notificação (7-8 dias)

**Escopo:**
- Página `/admin/templates` com listagem (por tipo, por evento, por idioma)
- CRUD completo
- Editor markdown com preview lado a lado
- Variáveis suportadas: {{nome}}, {{produto}}, {{link}}, {{tenant_name}}, etc
- Validação de variáveis (alerta se template usa variável não suportada)
- Botão "Enviar teste pro meu WhatsApp/email"
- Sistema de fila (BullMQ ou similar) com retry 3x + DLQ
- Dashboard `/admin/notifications/queue` com status: pendentes, 
  processando, falhas (DLQ)
- Integração com Evolution API (WhatsApp) e Resend (email)
- Audit log: editar/publicar template

**Critérios de aceite:**
- [ ] Magno edita template e envia teste pro próprio WhatsApp
- [ ] Magno edita template e envia teste pro próprio email
- [ ] Preview lado a lado renderiza corretamente
- [ ] Template com variável inválida → erro claro antes de salvar
- [ ] Falha de envio → vai pra DLQ + visível no admin
- [ ] Magno consegue reenviar manualmente um item da DLQ
- [ ] Testes E2E de envio completo (mock dos provedores externos)

#### Sub-fase 5.6 — Observability (6-8 dias)

**Escopo:**
- Página `/admin/webhooks` com viewer de WebhookDelivery
- Filtros: evento, status, tenant, data
- JSON viewer formatado (collapsible, syntax highlight)
- Links pra Order/User relacionados
- Indicador visual de signature OK/falha
- Botão "Replay" que reprocessa webhook (com confirmação)
- Página `/admin/events` com viewer de EventLog
- Filtros: tipo, level, tenant, usuário, Order
- Timeline visual de eventos por Order (clique numa Order → linha do tempo)
- Página `/admin/health` com dashboard de saúde:
  - Gráfico de taxa de sucesso de webhook (últimos 7 dias)
  - Gráfico de latência média
  - Top tipos de erro
  - Contadores: webhooks recebidos hoje, falhas, sucesso, dedupe
- Audit log: replay de webhook

**Critérios de aceite:**
- [ ] Magno encontra webhook específico em < 10s
- [ ] Magno faz replay de webhook que falhou (com confirmação dupla)
- [ ] Timeline visual de Order mostra cronologia: webhook → provisionado 
      → token → notificação → acesso → download
- [ ] Dashboard de saúde atualiza em tempo real
- [ ] Testes do fluxo de replay

#### Sub-fase 5.7 — Métricas Dashboard (8-10 dias)

**Escopo:**
- Página `/admin/metrics` com 4 abas: Vendas / Ativação / Engajamento / 
  Operacional
- **Aba Vendas:**
  - Contadores: hoje, semana, mês, total
  - Gráfico de vendas no tempo (Recharts)
  - Comparação: este mês vs mês passado, com variação %
  - Breakdown por produto/oferta
  - Top 10 clientes (por valor)
  - Export CSV
- **Aba Ativação:**
  - % de clientes que acessaram após comprar (em 1h, 24h, 7d)
  - Tempo médio compra → primeiro acesso
  - Gráfico de ativação no tempo
- **Aba Engajamento:**
  - Acessos por cliente (média, mediana)
  - Frequência de retorno
  - Completude de consumo (% de ContentItems acessados)
- **Aba Operacional:**
  - Já coberto na Sub-fase 5.6 (Observability) — link direto
- Filtros globais: período (hoje/semana/mês/customizado), produto, 
  status, tenant futuramente

**Critérios de aceite:**
- [ ] Magno responde "qual foi minha receita esta semana vs semana 
      passada?" em < 5s no admin
- [ ] Magno identifica produto que mais vende em < 5s
- [ ] Export CSV de qualquer aba funcional
- [ ] Gráficos responsivos e legíveis
- [ ] Testes de cálculo de métricas (cobertura de edge cases)

#### Sub-fase 5.8 — Polish + Testes E2E + Documentação (3-4 dias)

**Escopo:**
- Testes E2E end-to-end de fluxos críticos do admin (Playwright)
- Smoke tests dos principais fluxos
- Documentação do admin em `docs/ADMIN_GUIDE.md` (manual de uso pro Magno)
- Refinamentos de UX baseados em uso real durante as sub-fases anteriores
- Acessibilidade básica (ARIA labels, contraste)
- Performance: revisão de queries N+1 nas listagens

**Critérios de aceite:**
- [ ] Magno consegue executar fluxos completos sem documentação técnica
- [ ] Testes E2E passando: criar produto + cadastrar offer + ver order 
      processada + suspender entitlement + reativar
- [ ] Documentação tem screenshots de cada tela
- [ ] Lighthouse score > 90 em performance e acessibilidade

### Métrica-guia da Fase 5

**Magno opera 100% do catálogo Missa Explicada (11 produtos) via admin 
sem precisar de SQL ou Prisma Studio.**

### Cronograma e estimativa total

| Sub-fase | Estimativa |
|----------|------------|
| 5.0 Fundação | 5-7 dias |
| 5.1 Offers + OfferProducts | 6-8 dias |
| 5.2 Products + ContentItems | 7-9 dias |
| 5.3 Users + Orders | 7-9 dias |
| 5.4 Entitlements | 2-3 dias |
| 5.5 Templates | 7-8 dias |
| 5.6 Observability | 6-8 dias |
| 5.7 Métricas | 8-10 dias |
| 5.8 Polish + E2E | 3-4 dias |
| **TOTAL** | **51-66 dias úteis = 10-13 semanas** |

---

## Fase 1.6 — Notificações WhatsApp + email reais (após Fase 5)

**Por que veio depois da Fase 5:** templates de notificação são gerenciados 
pelo admin (Sub-fase 5.5). Fase 1.6 ativa templates em produção com 
provedores reais.

### Escopo
- Integração Evolution API (WhatsApp) configurada em produção
- Integração Resend (email) configurada em produção (com SPF, DKIM, DMARC)
- Templates criados via admin para: compra aprovada, magic link, reembolso
- Disparos durante provisionamento usando a fila configurada na Sub-fase 5.5

### Critérios de aceite
- [ ] Compra simulada dispara WhatsApp + email com link em < 10s
- [ ] Email cai na caixa de entrada (não spam) — domínio configurado
- [ ] Falhas vão pra DLQ e são visíveis no admin

### Estimativa: 3-4 dias

---

## Fase 1.7 — Deploy em produção + primeiro cliente real

**Critério de sucesso humano:** Mateus PARA de enviar PDF manualmente pra 
cada cliente que comprou Missa Explicada.

### Escopo
- Configurar Vercel (projeto vis-membros)
- Supabase prod (separado do dev)
- Env vars de produção
- DNS de `app.missaexplicada.com.br`
- Smoke tests pós-deploy
- Conectar webhook real na VIS apontando pra produção
- Migrar primeiros clientes existentes (manualmente, inicialmente)
- Suporte ativo durante onboarding dos primeiros 5-10 clientes

### Critérios de aceite
- [ ] Cliente real compra Missa Explicada na VIS
- [ ] Recebe link no WhatsApp em < 2 min
- [ ] Acessa, baixa o PDF, navega pela home
- [ ] Magno verifica audit log + métricas em tempo real
- [ ] 5 clientes reais usando a área antes de iniciar Fase 2

### Estimativa: 3-4 dias

---

## Fases futuras (não detalhadas)

- **Fase 2:** Multi-produto por oferta + Bônus PDFs ativados via admin
- **Fase 3:** Esteira contextual (upsell na home)
- **Fase 4:** PWA + Push Notifications
- **Fase 6:** Métricas de LTV avançadas
- **Fase 7:** Segundo tenant (ex: Misa Explicada Espanhol, Protocolo Alpha)

---

## Riscos transversais

| Risco | Mitigação |
|-------|-----------|
| Vazamento de dado entre tenants | Testes E2E de isolamento em CI |
| Webhook duplicado processando 2x | Idempotência tripla (visOrderId, payloadHash, deliveryId) |
| AccessToken vazando em logs/email | Nunca logar token; em emails, só URL completa |
| Cliente perde acesso por bug | Audit log completo + sempre SUSPEND em vez de DELETE |
| VIS muda contrato sem aviso | EventLog mantém raw payload; testes de contrato em CI |
| Mateus atrasa endpoint VIS | Fallback pra Caminho C (validação sob demanda) |
| Magno trava no launch | Decisões registradas, cada sub-fase com critério claro |

---

## Definição "pronto" universal (cada sub-fase)

1. ✅ Código tipado, sem `any`, sem TODOs pendentes
2. ✅ Testes passando (unit + integration crítica)
3. ✅ Lint, format e typecheck OK
4. ✅ Todos os critérios de aceite checados manualmente
5. ✅ EventLog gravando eventos relevantes
6. ✅ Audit log para ações críticas
7. ✅ Erros tratados (sem 500 em fluxo de produção)
8. ✅ Magno revisou e aprovou
9. ✅ Push pro GitHub autorizado
