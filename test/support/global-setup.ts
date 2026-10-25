import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { findRepoRoot, loadRootEnv } from "../../packages/shared/src/node";

/**
 * Runs once before the integration suite: applies migrations to the test
 * database and makes sure the demo store bundle exists.
 */
export default function setup(): void {
  loadRootEnv();
  const root = findRepoRoot();
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: the tests truncate every table.");
  }

  execSync("npx prisma migrate deploy", {
    cwd: path.join(root, "packages", "db"),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });

  if (!existsSync(path.join(root, "apps", "store", "dist", "index.html"))) {
    execSync("npm run build -w @reprolab/store", { cwd: root, stdio: "pipe" });
  }
}
