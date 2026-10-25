#!/usr/bin/env node
// Bundles a Node service into one ESM file for production.
//
//   node ../../scripts/build-node.mjs <entry.ts> <outfile.js>
//
// Workspace packages (@reprolab/*) are TypeScript sources, so they are bundled
// in. Third-party npm dependencies stay external and load from node_modules.
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("Usage: build-node.mjs <entry.ts> <outfile.js>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
const deps = Object.keys({ ...pkg.dependencies });
const workspaceDeps = new Set(deps.filter((d) => d.startsWith("@reprolab/")));
// Collect third-party deps of this package and of the workspace packages it uses.
const external = new Set(deps.filter((d) => !workspaceDeps.has(d)));
for (const dir of ["../../packages/shared", "../../packages/db"]) {
  const wsPkg = JSON.parse(readFileSync(path.resolve(dir, "package.json"), "utf8"));
  if (workspaceDeps.has(wsPkg.name)) for (const d of Object.keys(wsPkg.dependencies ?? {})) external.add(d);
}
for (const d of workspaceDeps) external.delete(d);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // Match "pkg" and "pkg/subpath" imports.
  external: [...external].flatMap((d) => [d, `${d}/*`]),
  // Lets bundled CommonJS-style code call require() inside an ESM bundle.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
