// ESLint flat config (ESLint 9) with a correct TypeScript setup.
//
// `typescript-eslint` supplies the parser AND plugin AND the recommended rule
// set, so `.ts` files are actually parsed as TypeScript instead of failing with
// "Unexpected token" diagnostics. The canonical `eslint .` (see package.json)
// runs this configuration against the whole repository; directories that ESLint
// should never touch are listed under `ignores`.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "extension/dist/**", "dist/**", "native-host/target/**", "test-results/**", "playwright-report/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  {
    // Plain-JS script files (remote CLI/local tooling) run on Node.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Browser extension modules.
    files: ["extension/src/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Unit, E2E and integration tests run under Node and include browser evaluation contexts.
    files: ["extension/tests/**/*.ts", "tests/**/*.{ts,js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
