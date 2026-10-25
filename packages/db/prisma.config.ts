import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma commands run from packages/db (npm -w sets the working directory).
// Load the repo-root .env without overriding variables that are already set.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed.ts",
  },
  datasource: {
    // A default lets `prisma generate` run before any .env exists.
    url: process.env.DATABASE_URL ?? "postgresql://reprolab:reprolab@127.0.0.1:5433/reprolab",
  },
});
