import { z } from "zod";

/** Removes ASCII control characters (keeps tab and newline) and normalises line endings. */
export function cleanText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

const text = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .transform(cleanText)
    .pipe(
      z
        .string()
        .trim()
        .min(min, `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be at most ${max} characters.`),
    );

export const LIMITS = {
  title: { min: 5, max: 120 },
  description: { min: 10, max: 4000 },
  expectedBehavior: { min: 5, max: 1000 },
  actualBehavior: { max: 1000 },
} as const;

export const ReportInputSchema = z.strictObject({
  title: text(LIMITS.title.min, LIMITS.title.max, "Title"),
  description: text(LIMITS.description.min, LIMITS.description.max, "Steps or description"),
  expectedBehavior: text(LIMITS.expectedBehavior.min, LIMITS.expectedBehavior.max, "Expected behavior"),
  actualBehavior: z
    .string()
    .transform(cleanText)
    .pipe(z.string().trim().max(LIMITS.actualBehavior.max, "Actual behavior must be at most 1000 characters."))
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});
export type ReportInput = z.output<typeof ReportInputSchema>;

export const RUN_MODES = ["SCRIPTED", "LIVE_AI"] as const;
export const RunModeSchema = z.enum(RUN_MODES, { error: 'Mode must be "SCRIPTED" or "LIVE_AI".' });
export type RunMode = z.infer<typeof RunModeSchema>;

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  SCRIPTED: "Scripted demo",
  LIVE_AI: "Live AI",
};

export const CreateReportRequestSchema = z.strictObject({
  report: ReportInputSchema,
  mode: RunModeSchema,
});
export type CreateReportRequest = z.input<typeof CreateReportRequestSchema>;

export const CreateRunRequestSchema = z.strictObject({ mode: RunModeSchema });

export const RUN_OUTCOMES = ["REPRODUCED", "NOT_REPRODUCED", "INCONCLUSIVE", "EXECUTION_FAILED"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export const RUN_OUTCOME_LABELS: Record<RunOutcome, string> = {
  REPRODUCED: "Reproduced",
  NOT_REPRODUCED: "Not reproduced",
  INCONCLUSIVE: "Inconclusive",
  EXECUTION_FAILED: "Execution failed",
};

export const RUN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
