# ADR 004 — Storage filesystem local com signed URLs HMAC

- **Status:** Aceito
- **Data:** 23/05/2026
- **Contexto da decisão:** Fase 2 da migração Vercel/Supabase → Titan/MySQL
- **Referência:** `ARCHITECTURE.md` v1.6, seção 3 (stack)
- **Supera:** [ADR 002](./002-supabase-js-storage-only.md) (`@supabase/supabase-js` apenas para Storage)

## Contexto

A Sub-fase 1.5 entregava conteúdo via **Supabase Storage** com signed URLs
geradas pelo SDK `@supabase/supabase-js`. A migração da infra para o droplet
**Titan** (que hospeda também a VIS Platform) torna o Supabase Storage uma
dependência externa cara: latência sa-east-1, custo de banda projetado,
lock-in de provedor.

Como o Titan já tem espaço em disco abundante (88GB livres no início, com
folga pros tamanhos esperados — PDFs/áudios), o storage local resolve o
problema sem cerimônia.

## Decisão

**Storage no filesystem local + signed URLs assinadas via HMAC-SHA256 nativo
do Node.** Sem dependências externas para esta camada.

1. **`src/lib/storage/local-storage.ts`** — `saveFile` / `readFile` /
   `deleteFile` / `fileExists` sobre filesystem (`STORAGE_PATH`).
   - Whitelist de MIME types (PDF, MP3/OGG, MP4/MOV) + checagem cruzada de
     extensão.
   - Limite de tamanho por categoria: PDF 50MB, áudio 100MB, vídeo 500MB.
   - Sanitização do nome (NFD, lowercase, sem path traversal) e validação
     `resolveFileKey` que rejeita qualquer caminho fora de `STORAGE_PATH`.
2. **`src/lib/storage/signed-urls-hmac.ts`** —
   `createSignedUrl(fileKey, ttlSec=900)` retorna
   `<payload_base64url>.<hmac_base64url>`. `validateSignedUrl(token)` confere
   o HMAC com `crypto.timingSafeEqual` e a expiração. TTL padrão **15 min**.
3. **`GET /api/files/[token]`** — valida o token → faz stream do arquivo.
   **Toda falha responde 404 com o mesmo corpo** (anti-enumeração: atacante
   não distingue token inválido, expirado, arquivo sumido ou erro de IO).
4. **`node:crypto` + `node:fs` nativos.** Zero deps adicionais.
5. `@supabase/supabase-js` **removido** do projeto.

## Alternativas consideradas

- **`jose` (JWT HS256)**: traria ~50KB para assinar tokens simples. HMAC nativo
  cobre o caso 1:1 com a mesma segurança, sem dep.
- **S3 (AWS) + signed URLs**: escala melhor e tem replicação built-in, mas
  adiciona custo, latência cross-cloud e lock-in. Considerar quando o volume
  justificar (Fase futura).
- **Manter Supabase Storage**: contraria a unificação da infra no Titan
  (objetivo principal da migração).

## Trade-offs

**Pros**
- **Lock-in zero**: filesystem é portável; uma migração futura para S3 troca
  apenas `local-storage.ts` (a interface se mantém).
- **Performance**: leitura local sem ida à rede.
- **Custo zero adicional**: espaço no Titan já provisionado.

**Cons**
- **Escala limitada**: filesystem mono-host. Múltiplos hosts → migrar para
  storage de objeto. Sem urgência no curto prazo (1 host basta).
- **Signed URLs não invalidáveis após emissão** (HMAC stateless). Mitigação:
  TTL curto (15 min) e o token só serve para 1 `fileKey`. Rotacionar
  `STORAGE_SIGN_SECRET` invalida em massa.
- **Backup do filesystem é responsabilidade do sysadmin** (sem replicação
  built-in). Estratégia em `RUNBOOK.md` Fase 4-7.

## Consequências operacionais

- **Prod:** `STORAGE_PATH=/var/data/vis-membros/files` (Titan). Backup do
  diretório entra no plano de backup do Titan.
- **Dev:** `STORAGE_PATH=./storage/files` (gitignored — `.gitkeep` e
  `README.md` versionados; arquivos não).
- **`STORAGE_SIGN_SECRET`** (32 bytes base64url) rotacionável; rotação
  invalida todos os tokens já emitidos (que respondem 404 silente).
- O `getContentSignedUrl` core agora **checa `fileExists` antes de assinar**
  — situação crítica (registro em DB aponta para arquivo sumido) é
  registrada em `EventLog` com `level=error`.

## Como usar

- **Gerar signed URL de um `ContentItem`:** `getContentSignedUrl(...)` do core
  (`src/lib/storage/get-content-signed-url.ts`).
- **Gerar signed URL de um `fileKey` arbitrário:** `createSignedUrl(fileKey, ttlSec)`.
- **Servir um arquivo:** `GET /api/files/<token>` (anti-enumeração embutida).
- **Gravar um upload:** `saveFile({ buffer, originalName, contentType, tenantSlug })`
  retorna `{ fileKey, sizeBytes }`.
