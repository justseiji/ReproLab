import { z } from "zod";
import { BrowserActionSchema, ExpectedOutcomeSchema } from "@reprolab/shared";

/**
 * Structured outputs the model must return. They are sent to the API as JSON
 * schemas (constrained decoding) AND re-validated here with Zod before use.
 * Neither schema has a field that could carry code or a URL.
 */

export const InterpretationSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    expectedOutcome: ExpectedOutcomeSchema,
    plan: z.array(z.string().max(200)).max(10),
  }),
  z.strictObject({
    status: z.literal("needs_clarification"),
    question: z.string().min(5).max(400),
  }),
  z.strictObject({
    status: z.literal("unsupported"),
    reason: z.string().min(5).max(400),
  }),
]);
export type Interpretation = z.infer<typeof InterpretationSchema>;

export const StepDecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("act"),
    action: BrowserActionSchema,
    rationale: z.string().max(300),
  }),
  z.strictObject({
    decision: z.literal("done"),
    rationale: z.string().max(300),
  }),
  z.strictObject({
    decision: z.literal("give_up"),
    reason: z.string().max(300),
  }),
]);
export type ModelStepDecision = z.infer<typeof StepDecisionSchema>;
