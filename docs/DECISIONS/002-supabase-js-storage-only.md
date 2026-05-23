# ADR 002 — `@supabase/supabase-js` apenas para Storage

- **Status:** ⚠️ **SUPERSEDED por [ADR 004](./004-storage-filesystem-local.md) em 23/05/2026**
- **Data original:** 21/05/2026
- **Contexto da decisão:** Sub-fase 1.5 (página do produto + download de PDF via signed URL)
- **Referência:** `ARCHITECTURE.md` v1.5, seção 3 (stack) e seção 5 (modelo de dados)

## Contexto

A sub-fase 1.5 precisa entregar arquivos (PDF do ebook) a partir de um bucket
**privado** do Supabase Storage, usando *signed URLs* temporárias. A forma
suportada de gerar essas URLs é o SDK oficial `@supabase/supabase-js`.

O risco: o `@supabase/supabase-js` é um SDK "guarda-chuva" — ele também faz
acesso a banco (PostgREST) e autenticação (Supabase Auth/GoTrue). Se o uso dele
vazar para o resto do código, passamos a ter **dois caminhos** para banco
(Prisma e supabase-js) e **dois caminhos** para auth (Lucia e supabase-js),
quebrando duas decisões já tomadas:

- Banco: o acesso é **sempre** via Prisma + `scoped-db` (ver ADR 001). Um
  segundo caminho ignoraria o tenant-scoping e a tipagem.
- Auth: a autenticação é **sempre** via Lucia v3 (sessão + magic link).

Além disso, o client é criado com a `SUPABASE_SERVICE_ROLE_KEY`, que **ignora
RLS** — é equivalente a admin do banco. Espalhar esse client aumenta a
superfície de exposição da chave.

## Decisão

O `@supabase/supabase-js` é usado **exclusivamente para o Supabase Storage** e
fica **encapsulado em `src/lib/storage/`**.

1. **Único ponto de entrada:** `src/lib/storage/supabase-client.ts` é o único
   módulo do projeto que importa `@supabase/supabase-js`. Ele expõe
   `getSupabaseStorageClient()` (singleton).
2. **Nenhum outro módulo** importa `@supabase/supabase-js` diretamente — usa as
   funções de `src/lib/storage/` (`createSignedUrl`, `checkObjectExists`,
   `getContentSignedUrl`).
3. **Só no servidor.** O client carrega a `SUPABASE_SERVICE_ROLE_KEY`; nunca é
   importado de Client Components nem exposto ao browser.
4. **Banco continua no Prisma; auth continua no Lucia.** O supabase-js não toca
   em nenhum dos dois.

## Consequências

**Positivas**

- A regra "banco = Prisma, auth = Lucia" continua válida sem exceção.
- A `SUPABASE_SERVICE_ROLE_KEY` fica confinada a um módulo — fácil de auditar.
- Trocar o provedor de Storage no futuro afeta só `src/lib/storage/`.

**Negativas / trade-offs**

- A regra "só importar supabase-js em `src/lib/storage/`" é uma convenção: não
  há trava de compilador. Mitigação: comentário-cabeçalho explícito em
  `supabase-client.ts` e verificação por `grep "supabase-js"` na revisão.
- O bundle do servidor carrega o SDK inteiro, mesmo usando só o Storage —
  custo aceitável (código server-side, não vai para o browser).

## Como usar

- **Gerar signed URL de um ContentItem:** `getContentSignedUrl(...)` do core
  `src/lib/storage/get-content-signed-url.ts`.
- **Gerar signed URL de um path arbitrário:** `createSignedUrl(bucket, path)`.
- **Precisa do client cru do Storage:** `getSupabaseStorageClient()` — e
  somente dentro de `src/lib/storage/`.

## Por que foi superada

A migração para infra unificada com a VIS Platform (Fases 1–3 de
maio/2026) moveu o banco para **MySQL no Titan** e o storage para
**filesystem local com signed URLs HMAC** (ver [ADR 005](./005-banco-mysql-titan.md)
e [ADR 004](./004-storage-filesystem-local.md)). O `@supabase/supabase-js`
deixou de existir no projeto — `src/lib/storage/supabase-client.ts` e
`src/lib/storage/signed-urls.ts` foram deletados; foram substituídos por
`local-storage.ts` + `signed-urls-hmac.ts`. As regras desta ADR (banco =
Prisma, auth = Lucia) seguem válidas — apenas o **provedor** de Storage
mudou. A ADR fica preservada como histórico do raciocínio que sustentou
a sub-fase 1.5.
