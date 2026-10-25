import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, type Db } from "@reprolab/db";
import { findRepoRoot, loadConfig, type AppConfig } from "@reprolab/shared/node";

/** Test-only helpers shared by the integration suites. */

export function testDb(): Db {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  return createDb(url);
}

/** Deletes all rows. Reports cascade to runs, jobs, actions, evidence, artifacts and events. */
export async function resetDb(db: Db): Promise<void> {
  await db.$executeRawUnsafe(`TRUNCATE "Report", "Run", "Job", "RunAction", "RunEvidence", "Artifact", "RunEvent" CASCADE`);
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    ARTIFACT_DIR: mkdtempSync(path.join(tmpdir(), "reprolab-artifacts-")),
    AI_PROVIDER: "anthropic",
    AI_MODEL: "",
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    GEMINI_API_KEY: "",
    JOB_LEASE_MS: "30000",
    RUN_TIMEOUT_MS: "60000",
    ...overrides,
  });
}

export const storeDistDir = () => path.join(findRepoRoot(), "apps", "store", "dist");
