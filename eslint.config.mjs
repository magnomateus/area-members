import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * ESLint flat config.
 *
 * `eslint-config-next` 16 ja exporta flat configs nativos — nao usamos FlatCompat.
 * `eslint-config-prettier` vem por ultimo para desativar regras que conflitam
 * com o Prettier (formatacao fica 100% a cargo do Prettier).
 */
const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "prisma/migrations/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
];

export default eslintConfig;
