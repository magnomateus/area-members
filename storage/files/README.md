# `storage/files/` — Storage local de conteúdo (dev)

Esta pasta é o **STORAGE_PATH** em desenvolvimento. Em produção o caminho
é `/var/data/vis-membros/files`. Ver `src/lib/storage/local-storage.ts` e
`docs/DECISIONS/004-local-filesystem-storage.md`.

## Layout

```
storage/files/
  <tenant-slug>/
    <uniqueId>-<sanitized-name>.<ext>
```

O `uniqueId` é prefixado pelo `saveFile()` para evitar colisões; o
`sanitized-name` é gerado de `originalName` (minúsculas, sem diacríticos,
sem caracteres especiais). O `fileKey` armazenado no banco é o caminho
**relativo** a `STORAGE_PATH` (ex.: `missa-explicada/abc123-ebook.pdf`).

## ⚠️ Arquivo do seed — coloca manualmente

O seed cria um `ContentItem` apontando para `missa-explicada/ebook.pdf`.
Esse arquivo não está versionado — coloca o PDF aqui:

```
storage/files/missa-explicada/ebook.pdf
```

Em dev, qualquer PDF serve (até um arquivo dummy de poucos KB). Pra
testar o fluxo end-to-end com o PDF real, baixa do Supabase enquanto ele
ainda estiver ativo e copia pra cá.

## Versionamento

A pasta em si é versionada (`.gitkeep` + este README); os arquivos
dentro **não** são (ver `.gitignore` — `storage/files/*` ignorado, exceto
`.gitkeep` e `README.md`).
