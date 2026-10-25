import { liveAiStatus, type AppConfig } from "@reprolab/shared/node";
import { createModelProvider } from "../ai/registry";
import { InfraError } from "../errors";
import type { PlannerFactory } from "../worker";
import { LiveAiPlanner } from "./live-ai";
import { ScriptedPlanner } from "./scripted";

export { createModelProvider };

/** Picks the planner for a run's mode. `provider` can be replaced in tests. */
export function createPlannerFactory(config: AppConfig, provider = createModelProvider(config)): PlannerFactory {
  return (run) => {
    if (run.mode === "SCRIPTED") return new ScriptedPlanner(run.report.seedKey, config.run.maxActionsScripted);
    if (!provider) {
      const reason = liveAiStatus(config).reason ?? "Live AI mode is not configured for the worker.";
      throw new InfraError("AI_NOT_CONFIGURED", reason, false);
    }
    const report = {
      title: run.report.title,
      description: run.report.description,
      expectedBehavior: run.report.expectedBehavior,
      actualBehavior: run.report.actualBehavior ?? undefined,
    };
    return new LiveAiPlanner(provider, report, config.run.maxActionsLive, config.ai.pricing);
  };
}
