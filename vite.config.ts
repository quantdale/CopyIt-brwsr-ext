import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "extension",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "extension/popup.html"),
      },
      output: {
        entryFileNames: "src/[name].js",
        chunkFileNames: "src/[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
    target: "es2020",
    minify: false,
  },
  publicDir: false,
});
