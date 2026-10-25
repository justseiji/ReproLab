#!/usr/bin/env node
// Fallback for machines without Docker: runs a project-local PostgreSQL cluster
// using PostgreSQL binaries that are already installed on the host.
//
//   node scripts/local-postgres.mjs start | stop | status
//
// The cluster lives in .data/postgres, listens on 127.0.0.1:5433 (same as the
// Docker Compose service), and uses trust auth for local connections only.
// It never touches a system-wide PostgreSQL installation or service.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".data", "postgres");
const logFile = path.join(root, ".data", "postgres.log");
const port = process.env.LOCAL_PG_PORT ?? "5433";
const user = "reprolab";
const databases = ["reprolab", "reprolab_test"];
const exe = process.platform === "win32" ? ".exe" : "";

function findBinDir() {
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) candidates.push(dir);
  const versioned = (base) =>
    existsSync(base)
      ? readdirSync(base)
          .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a))
          .map((v) => path.join(base, v, "bin"))
      : [];
  if (process.platform === "win32") candidates.push(...versioned("C:\\Program Files\\PostgreSQL"));
  candidates.push(...versioned("/usr/lib/postgresql"));
  candidates.push("/opt/homebrew/bin", "/usr/local/bin");
  return candidates.find((dir) => dir && existsSync(path.join(dir, `pg_ctl${exe}`)));
}

const binDir = findBinDir();
if (!binDir) {
  console.error("Could not find pg_ctl. Install PostgreSQL or set PG_BIN to its bin directory.");
  process.exit(1);
}
const bin = (name) => path.join(binDir, `${name}${exe}`);

function isRunning() {
  return spawnSync(bin("pg_ctl"), ["-D", dataDir, "status"], { stdio: "ignore" }).status === 0;
}

function start() {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`Initialising cluster in ${path.relative(root, dataDir)} ...`);
    execFileSync(bin("initdb"), ["-D", dataDir, "-U", user, "--auth=trust", "--encoding=UTF8", "--no-locale"], {
      stdio: "inherit",
    });
  }
  if (!isRunning()) {
    // stdio must not be shared with the server process: on Windows it inherits
    // the handles and the call never returns. Server output goes to the log file.
    const result = spawnSync(
      bin("pg_ctl"),
      ["-D", dataDir, "-l", logFile, "-w", "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "start"],
      { stdio: "ignore" },
    );
    if (result.status !== 0) {
      console.error(`pg_ctl failed to start the server. See ${path.relative(root, logFile)}.`);
      process.exit(1);
    }
  }
  for (const db of databases) {
    const result = spawnSync(bin("createdb"), ["-h", "127.0.0.1", "-p", port, "-U", user, db], { encoding: "utf8" });
    if (result.status !== 0 && !String(result.stderr).includes("already exists")) {
      console.error(result.stderr);
      process.exit(1);
    }
  }
  console.log(`PostgreSQL is running on 127.0.0.1:${port} (databases: ${databases.join(", ")}).`);
}

function stop() {
  if (!isRunning()) return console.log("Local PostgreSQL is not running.");
  execFileSync(bin("pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "stop"], { stdio: "inherit" });
}

const command = process.argv[2] ?? "start";
if (command === "start") start();
else if (command === "stop") stop();
else if (command === "status") console.log(isRunning() ? "running" : "stopped");
else {
  console.error(`Unknown command "${command}". Use start, stop or status.`);
  process.exit(1);
}
