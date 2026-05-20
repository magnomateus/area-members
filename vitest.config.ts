import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Carrega o `.env` para `process.env` dos testes. Parser próprio para não
 * depender do `vite` como import direto (ele é dependência transitiva do
 * vitest e não resolve de forma confiável pelo pnpm).
 */
function loadDotEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(new URL("./.env", import.meta.url), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // .env ausente — testes que dependem de banco falham com mensagem clara.
  }
  return env;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: loadDotEnv(),
    // Testes de integração usam transações de rollback no mesmo banco —
    // sem paralelismo entre arquivos para evitar corridas.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
