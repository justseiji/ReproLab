import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Node-only helpers (kept out of the main entry so the browser bundles never
 * pull in node:fs).
 */

/** Walks up from `start` to the monorepo root (the package.json with "workspaces"). */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).workspaces) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/**
 * Loads the repo-root .env into process.env without overriding variables that
 * are already set. Uses Node's built-in parser (no dotenv dependency).
 */
export function loadRootEnv(): string {
  const root = findRepoRoot();
  const file = process.env.REPROLAB_ENV_FILE ?? path.join(root, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
  return root;
}

/** Resolves a possibly relative path against the repo root. */
export function fromRepoRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(findRepoRoot(), p);
}

export { liveAiStatus, loadConfig, type AppConfig } from "./config";
