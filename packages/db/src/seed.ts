import { SEEDED_REPORTS } from "@reprolab/shared";
import { loadRootEnv } from "@reprolab/shared/node";
import { createDb } from "./client";

/**
 * Seeds the three sample reports. Idempotent: reports are upserted by seed key,
 * so re-running refreshes their text without duplicating them or their runs.
 * Products are not stored here: the catalog lives in the store specification
 * (packages/shared/src/store-spec.ts) and the demo store serves it from memory.
 */
loadRootEnv();
const db = createDb();

for (const seeded of SEEDED_REPORTS) {
  const data = {
    title: seeded.title,
    description: seeded.description,
    expectedBehavior: seeded.expectedBehavior,
    actualBehavior: seeded.actualBehavior ?? null,
  };
  await db.report.upsert({ where: { seedKey: seeded.seedKey }, create: { ...data, seedKey: seeded.seedKey }, update: data });
  console.log(`Seeded report: ${seeded.title}`);
}
await db.$disconnect();
