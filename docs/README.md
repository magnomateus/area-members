# Documentação — Plataforma de Membros VIS

Documentos de fundação do projeto. São a **fonte da verdade**: em caso de
conflito entre o código e estes documentos, os documentos prevalecem.

| Documento | O que é |
|-----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | A "constituição" — objetivo, modelo conceitual, stack, modelo de dados (Prisma), autenticação, autorização, multi-tenancy, segurança, estrutura de pastas e variáveis de ambiente. |
| [WEBHOOK_CONTRACT.md](./WEBHOOK_CONTRACT.md) | Contrato de integração com a VIS Platform — payloads, validação HMAC, idempotência, mapeamento de eventos e polling. |
| [PHASES.md](./PHASES.md) | Roadmap de implementação — fases, sub-fases e critérios de aceite. |
| [DECISIONS/](./DECISIONS/) | ADRs (Architecture Decision Records). Ainda vazio. |
| [RUNBOOK.md](./RUNBOOK.md) | Procedimentos operacionais. Stub — preenchido a partir do deploy (Fase 1.7). |

## Como usar com o Claude Code

Cada prompt de implementação deve incluir o **trecho relevante** do
`ARCHITECTURE.md` mais a sub-fase atual do `PHASES.md`. Ver `ARCHITECTURE.md`
seção 15.
