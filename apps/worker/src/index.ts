import { createDb } from "@reprolab/db";
import { liveAiStatus, loadConfig } from "@reprolab/shared/node";
import { createPlannerFactory } from "./planners/factory";
import { Worker } from "./worker";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const worker = new Worker(db, config, createPlannerFactory(config));

const ai = liveAiStatus(config);
console.log(
  `[worker] ${worker.id} starting: concurrency ${config.worker.concurrency}, store ${config.storeUrl}, ` +
    `live AI ${ai.available ? `enabled (${config.ai.provider} / ${config.ai.model})` : `disabled: ${ai.reason}`}`,
);
worker.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    console.log(`[worker] ${signal} received; returning active runs to the queue...`);
    await worker.stop();
    await db.$disconnect();
    process.exit(0);
  });
}
