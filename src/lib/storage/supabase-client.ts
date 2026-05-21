import { type SupabaseClient, createClient } from "@supabase/supabase-js";

/**
 * ⚠️ ÚNICO ponto de entrada do `@supabase/supabase-js` no projeto.
 *
 * Decisão de arquitetura — ver docs/DECISIONS/002-supabase-js-storage-only.md:
 * o `@supabase/supabase-js` é usado EXCLUSIVAMENTE para o Supabase Storage.
 * NÃO para banco (isso é o Prisma) e NÃO para auth (isso é o Lucia). Nenhum
 * outro módulo deve importar `@supabase/supabase-js` diretamente — importe
 * sempre a partir de `src/lib/storage/`.
 *
 * O client é criado com a `SUPABASE_SERVICE_ROLE_KEY` (admin — ignora RLS).
 * Por isso este módulo SÓ pode rodar no servidor; nunca importar de Client
 * Components nem expor a chave ao browser.
 */

// Singleton — o hot-reload do Next reavalia módulos a cada mudança; guardar a
// instância no escopo global evita recriar o client a cada reload.
const globalForStorage = globalThis as unknown as {
  supabaseStorage: SupabaseClient | undefined;
};

export function getSupabaseStorageClient(): SupabaseClient {
  if (globalForStorage.supabaseStorage) {
    return globalForStorage.supabaseStorage;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para o Supabase Storage " +
        "(ver .env.example).",
    );
  }

  const client = createClient(url, serviceRoleKey, {
    // Não é uma sessão de usuário — é uma chave de serviço. Sem persistência
    // nem refresh de token.
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (process.env.NODE_ENV !== "production") {
    globalForStorage.supabaseStorage = client;
  }
  return client;
}
