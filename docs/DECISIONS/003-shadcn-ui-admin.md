# ADR 003 — shadcn/ui no Admin Dashboard

- **Status:** Aceito
- **Data:** 22/05/2026
- **Contexto da decisão:** Sub-fase 5.0 (Fundação do Admin Dashboard)
- **Referência:** `PHASES.md` v2.0 (Fase 5), `ARCHITECTURE.md` seção 3

## Contexto

A Fase 5 entrega o Admin Dashboard — uma ferramenta operacional interna com
muitos componentes complexos e padronizados: tabelas com filtros, dropdowns,
diálogos, formulários, toasts, drawers. Construir tudo isso à mão em Tailwind
puro seria lento e inconsistente.

O cliente final (`(public)` / `(member)`) **não** tem esse problema: são poucas
telas, mobile-first, com branding por tenant — e já estão construídas em
Tailwind puro (Fases 1.1–1.5).

## Decisão

Adotar **shadcn/ui exclusivamente no admin**.

1. **Só no admin, não no cliente final.** O cliente final continua em Tailwind
   puro, com branding por tenant. O admin é interno, sem branding por tenant —
   tema claro único. Isso evita acoplar o sistema de tokens do shadcn ao
   branding do cliente e evita inflar o bundle do cliente.
2. **Versão — CLI `shadcn@2.10.0` (geração Tailwind v3).** O projeto usa
   **Tailwind v3.4.17**. A linha `shadcn@2.x` é a geração Tailwind v3; a `3.x`
   assume Tailwind v4. O CLI 2.10.0 detectou o `tailwind.config.ts` v3 e gerou
   tokens HSL via CSS variables + plugin `tailwindcss-animate`.
3. **Estrutura de pastas:**
   - `src/components/admin/ui/` — componentes gerados pelo shadcn CLI.
   - `src/components/admin/` — composições e componentes próprios do admin
     (layout, sidebar, etc.).
   - `components.json` — aliases repontados: `ui → @/components/admin/ui`,
     `components → @/components/admin`.
   - `src/lib/utils.ts` — helper `cn` (compartilhado).
4. **Convenção de uso:**
   - Adicionar componentes **sempre via `shadcn` CLI** (`pnpm dlx shadcn@2 add`).
   - Os arquivos em `src/components/admin/ui/` são "código do projeto" — podem
     ser customizados, mas a fonte primária é o CLI.
   - Customizações maiores e composições ficam em `src/components/admin/`,
     nunca dentro de `ui/`.

## Consequências

**Positivas**
- Componentes acessíveis e prontos para produção (Radix por baixo).
- Velocidade de desenvolvimento das 8 sub-fases seguintes da Fase 5.
- Bundle do cliente final intocado.

**Negativas / trade-offs**
- `shadcn@2.x` está atrelado a Tailwind v3; um futuro upgrade para Tailwind v4
  exigirá migração dos tokens (decisão deliberada de fase futura).
- O CLI do shadcn invoca o package manager (`pnpm`) internamente — neste
  ambiente o `pnpm` não está no PATH, então `init`/`add` precisam ser rodados
  com o diretório do pnpm prefixado no PATH. Anotado no RUNBOOK se recorrente.

## Como usar

```bash
# Adicionar um componente novo (vai para src/components/admin/ui/)
pnpm dlx shadcn@2 add <componente>
```
