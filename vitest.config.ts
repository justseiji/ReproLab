import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Workspace packages are TypeScript sources; point Vitest straight at them.
const alias = [
  { find: /^@reprolab\/shared\/node$/, replacement: src("./packages/shared/src/node.ts") },
  { find: /^@reprolab\/shared$/, replacement: src("./packages/shared/src/index.ts") },
  { find: /^@reprolab\/db$/, replacement: src("./packages/db/src/index.ts") },
];

// Two projects:
// - unit: pure logic, no services needed.
// - integration: real PostgreSQL (TEST_DATABASE_URL), real Chromium, the built demo store.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/test/**/*.unit.test.ts", "apps/*/test/**/*.unit.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/*/test/**/*.int.test.ts", "apps/*/test/**/*.int.test.ts"],
          globalSetup: ["test/support/global-setup.ts"],
          setupFiles: ["test/support/setup-env.ts"],
          // Integration files share one database, so they run one at a time.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
