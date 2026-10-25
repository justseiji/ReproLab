import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export interface TestRunResult {
  /**
   * passed: the test ran and passed.
   * assertion_failed: the test ran and an expect() assertion failed (the bug is present).
   * error: the test did not run properly (syntax error, missing module, crash) — proves nothing.
   */
  outcome: "passed" | "assertion_failed" | "error";
  passed: boolean;
  durationMs: number;
  /** First error line from Playwright, if any. */
  message: string | null;
  /** Tail of the Playwright output, for diagnostics. */
  output: string;
}

interface JsonReport {
  suites?: JsonSuite[];
  errors?: Array<{ message?: string }>;
}
interface JsonSuite {
  suites?: JsonSuite[];
  specs?: Array<{ tests: Array<{ results: Array<{ status: string; errors?: Array<{ message?: string }> }> }> }>;
}

function collectResults(suites: JsonSuite[] = []): Array<{ status: string; message: string | null }> {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.flatMap((t) => t.results.map((r) => ({ status: r.status, message: r.errors?.[0]?.message ?? null }))),
    ),
    ...collectResults(suite.suites),
  ]);
}

/**
 * Writes a generated regression test to `dir` and runs it with the real
 * Playwright test runner against the demo store — exactly what a developer
 * would do with the downloaded file. `dir` must be inside the repository so
 * the test can import @playwright/test.
 */
export async function runGeneratedTest(options: {
  dir: string;
  fileName: string;
  code: string;
  storeUrl: string;
}): Promise<TestRunResult> {
  await mkdir(options.dir, { recursive: true });
  await writeFile(path.join(options.dir, options.fileName), options.code, "utf8");
  const configPath = path.join(options.dir, "playwright.config.mjs");
  const reportPath = path.join(options.dir, "results.json");
  await rm(reportPath, { force: true });
  await writeFile(
    configPath,
    `export default { testDir: ".", testMatch: ${JSON.stringify(options.fileName)}, timeout: 30000, retries: 0, workers: 1, ` +
      `reporter: [["line"], ["json", { outputFile: ${JSON.stringify(reportPath)} }]], use: { headless: true } };\n`,
    "utf8",
  );

  // Resolve the runner from the test's own directory, exactly as the test's
  // `import "@playwright/test"` will be resolved, so both share one module instance.
  const cli = createRequire(path.join(options.dir, "noop.js")).resolve("@playwright/test/cli");
  const started = Date.now();
  const { output } = await new Promise<{ output: string }>((resolve) => {
    const child = spawn(process.execPath, [cli, "test", "--config", configPath], {
      cwd: options.dir,
      env: { ...process.env, STORE_URL: options.storeUrl, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("close", () => resolve({ output: text.slice(-4000) }));
  });
  const durationMs = Date.now() - started;

  const report = (await readFile(reportPath, "utf8").then(JSON.parse).catch(() => null)) as JsonReport | null;
  const results = collectResults(report?.suites);
  // Playwright error messages contain terminal colour codes (ESC [ ... m); strip them.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const firstLine = (s: string | null | undefined) =>
    s ? (s.replace(ansi, "").split("\n").find((l) => l.trim())?.trim() ?? null) : null;
  if (results.length !== 1) {
    return { outcome: "error", passed: false, durationMs, message: firstLine(report?.errors?.[0]?.message) ?? "No test ran.", output };
  }
  const [result] = results as [{ status: string; message: string | null }];
  if (result.status === "passed") return { outcome: "passed", passed: true, durationMs, message: null, output };
  const isAssertion = result.status === "failed" && /expect\(/.test(result.message ?? "");
  return { outcome: isAssertion ? "assertion_failed" : "error", passed: false, durationMs, message: firstLine(result.message), output };
}
