import { findRecipe, type BrowserAction, type ScriptedRecipe } from "@reprolab/shared";
import type { Planner, Preparation, StepDecision, StepInput } from "./types";

/**
 * Scripted demo mode: replays a predefined recipe for one of the seeded
 * reports. Each step names its element by test id and is resolved against the
 * live observation, so it goes through the same validation as model output.
 * Reports without a recipe are not guessed at: the run ends Inconclusive and
 * says that live AI mode is required.
 */
export class ScriptedPlanner implements Planner {
  readonly mode = "SCRIPTED" as const;
  readonly label = "Scripted demo";
  private readonly recipe: ScriptedRecipe | undefined;
  private cursor = 0;

  constructor(
    seedKey: string | null,
    readonly maxActions: number,
  ) {
    this.recipe = findRecipe(seedKey);
  }

  async prepare(): Promise<Preparation> {
    if (!this.recipe) {
      return {
        kind: "inconclusive",
        reasonCode: "SCRIPTED_RECIPE_UNAVAILABLE",
        summary:
          "Scripted demo mode only has recipes for the three seeded reports. Live AI mode is required to reproduce this report.",
      };
    }
    return {
      kind: "ready",
      expected: this.recipe.expected,
      plan: this.recipe.steps.map((s) => ("testId" in s ? `${s.type} ${s.testId}` : s.type === "navigate" ? `navigate ${s.route}` : s.type)),
    };
  }

  async next(input: StepInput): Promise<StepDecision> {
    const recipe = this.recipe!;
    const last = input.history.at(-1);
    if (last && last.status !== "succeeded") {
      return { kind: "stop", stopReason: "step_failed", detail: `Recipe step ${last.index} failed: ${last.error ?? "unknown error"}` };
    }
    const step = recipe.steps[this.cursor];
    if (!step) return { kind: "stop", stopReason: "completed", detail: "Recipe finished." };
    this.cursor += 1;

    let action: BrowserAction;
    if (step.type === "navigate") action = { type: "navigate", route: step.route };
    else if (step.type === "inspect") action = { type: "inspect" };
    else {
      const element = input.observation.elements.find((e) => e.testId === step.testId);
      if (!element) {
        return {
          kind: "stop",
          stopReason: "step_failed",
          detail: `Recipe step ${this.cursor}: no element with test id "${step.testId}" on ${input.observation.path || "the page"}.`,
        };
      }
      if (step.type === "click") action = { type: "click", elementId: element.id };
      else if (step.type === "fill") action = { type: "fill", elementId: element.id, value: step.value };
      else action = { type: "select", elementId: element.id, option: step.option };
    }
    return { kind: "act", action, rationale: `Recipe step ${this.cursor} of ${recipe.steps.length}` };
  }

  usage() {
    return null;
  }
}
