import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev:client` serves the storefront with hot reload and proxies the
// store API. Reproduction runs always use the built bundle served by server/.
export default defineConfig({
  plugins: [react()],
  // Workspace packages are consumed as TypeScript source.
  resolve: {
    alias: { "@reprolab/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)) },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5174, proxy: { "/api": "http://localhost:4100" } },
});
