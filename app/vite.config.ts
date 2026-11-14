import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    // stellar-sdk expects `global` in the browser
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: fileURLToPath(new URL("./node_modules/buffer/index.js", import.meta.url)),
    },
    dedupe: ["@stellar/stellar-sdk"],
  },
  optimizeDeps: {
    include: ["buffer", "@stellar/stellar-sdk", "@stellar/stellar-sdk/rpc"],
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8790",
      "/d/": "http://127.0.0.1:8790",
    },
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /smart-account-kit/],
      transformMixedEsModules: true,
    },
  },
});
