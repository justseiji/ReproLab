import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the UI runs on Vite and proxies /api to the Fastify API.
// In production the API serves the built files from apps/web/dist.
export default defineConfig({
  plugins: [react()],
  // Workspace packages are consumed as TypeScript source.
  resolve: {
    alias: { "@reprolab/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)) },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5173, host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:4000" } },
});
