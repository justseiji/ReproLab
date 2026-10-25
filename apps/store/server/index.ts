import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@reprolab/shared/node";
import { createStoreServers, parseBugSetting } from "./app";

loadRootEnv();

// Works from both server/index.ts (dev) and dist-server/index.js (production).
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.STORE_PORT ?? 4100);
const adminPort = Number(process.env.STORE_ADMIN_PORT ?? 4101);
const host = process.env.STORE_HOST ?? "localhost";

const store = await createStoreServers({ distDir, bugs: parseBugSetting(process.env.STORE_BUGS), logger: true });

await store.publicApp.listen({ port, host });
// The admin server is never exposed beyond the loopback interface.
await store.adminApp.listen({ port: adminPort, host: "127.0.0.1" });
store.publicApp.log.info(`Demo store on http://${host}:${port} (admin on 127.0.0.1:${adminPort})`);
store.publicApp.log.info({ bugs: store.getBugs() }, "Initial bug switches");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await Promise.allSettled([store.publicApp.close(), store.adminApp.close()]);
    process.exit(0);
  });
}
