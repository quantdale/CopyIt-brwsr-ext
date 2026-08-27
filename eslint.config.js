export default [
  { ignores: ["extension/dist/**", "native-host/target/**", "node_modules/**", "dist/**"] },
  {
    files: ["extension/src/**/*.{ts,js}", "extension/tests/**/*.{ts,js}", "tests/**/*.{ts,js}", "scripts/**/*.{js,mjs}"],
    languageOptions: { ecmaVersion: 2020, sourceType: "module" },
    rules: {},
  },
];
