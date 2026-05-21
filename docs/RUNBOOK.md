# RUNBOOK.md — Procedimentos operacionais

> Stub. Este documento será preenchido a partir do deploy em produção
> (Fase 1.7 do `PHASES.md`) com procedimentos de operação, diagnóstico e
> resposta a incidentes.

## Seções previstas

- Deploy e rollback
- Diagnóstico de webhook que falhou
- Reenvio de magic link para um cliente
- Suspensão / reativação manual de acesso
- Restore de banco

---

## Integração de webhook — produto DEV da VIS

O webhook secret é **por produto VIS**, armazenado em `Offer.visWebhookSecret`
(ver `WEBHOOK_CONTRACT.md` seção 4 e `ARCHITECTURE.md` seção 5).

O seed cria a Offer **"Missa Explicada DEV"** com `visProductId = 99999` e um
`visWebhookSecret` **fake** (`dev-webhook-secret-for-testing-only`) — valores de
placeholder, suficientes para os testes automatizados e o `/simulate`.

Quando o Mateus criar o **produto DEV real** na VIS e gerar o `webhook_secret`
de verdade, o Magno deve atualizar a Offer DEV no banco — via **Prisma Studio**
(`pnpm db:studio`) ou SQL — com **os dois** campos:

1. `visProductId` → o id real do produto DEV na VIS (substitui o `99999`);
2. `visWebhookSecret` → o `webhook_secret` real entregue pelo Mateus.

Esses valores **não vão para o git** (são credenciais / dados de ambiente).
Sem o ajuste do `visProductId`, o `webhook.test` real disparado pelo painel da
VIS não resolverá a Offer e o tenant.

## Diagnóstico de webhook

Todo webhook recebido gera um registro em `WebhookDelivery` (técnico/forense:
`rawPayload`, `rawHeaders`, `payloadHash`, `signatureValid`, `signatureReason`)
e em `EventLog` (evento de negócio). Para investigar uma falha, consulte
`WebhookDelivery` pelo `payloadHash` ou `visDeliveryId` e veja `errorMessage` /
`signatureReason`.
