import path from "node:path";
import { createDb } from "@reprolab/db";
import { findRepoRoot, loadConfig } from "@reprolab/shared/node";
import { buildApp } from "./app";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = await buildApp({
  db,
  config,
  logger: true,
  webDistDir: path.join(findRepoRoot(), "apps", "web", "dist"),
});

if (!["127.0.0.1", "localhost", "::1"].includes(config.api.host)) {
  app.log.warn(
    `API_HOST=${config.api.host} exposes an API with no authentication. ` +
      "Only do this behind authentication, access control and rate limiting.",
  );
}
await app.listen({ host: config.api.host, port: config.api.port });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
}
