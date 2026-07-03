import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Node-only guard: these services import node:crypto (directly or
    // transitively) and must never enter a browser-bundled chain.
    files: [
      "src/pages/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/contexts/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "@/services/structuredBankStatementCsvIdempotencyKeys",
            "@/services/structuredBankStatementCsvPreIngestion",
            "@/services/structuredBankStatementCsvNodeIngestionRuntime",
            "../services/structuredBankStatementCsvIdempotencyKeys",
            "../services/structuredBankStatementCsvPreIngestion",
            "../services/structuredBankStatementCsvNodeIngestionRuntime",
            "./structuredBankStatementCsvIdempotencyKeys",
            "./structuredBankStatementCsvPreIngestion",
            "./structuredBankStatementCsvNodeIngestionRuntime",
          ].map((name) => ({
            name,
            message:
              "Node-only module (pulls node:crypto into the bundle); it must never enter a browser chain (pages, components, hooks, contexts).",
          })),
          patterns: [
            {
              group: [
                "**/structuredBankStatementCsvIdempotencyKeys",
                "**/structuredBankStatementCsvPreIngestion",
                "**/structuredBankStatementCsvNodeIngestionRuntime",
              ],
              message:
                "Node-only module (pulls node:crypto into the bundle); it must never enter a browser chain (pages, components, hooks, contexts).",
            },
          ],
        },
      ],
    },
  }
);
