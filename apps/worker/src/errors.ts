import type { ReasonCode } from "@reprolab/shared";

/**
 * An infrastructure problem: the run could not be carried out, which says
 * nothing about the bug. Becomes EXECUTION_FAILED unless a retry succeeds.
 */
export class InfraError extends Error {
  constructor(
    readonly reasonCode: ReasonCode,
    message: string,
    /** Transient errors are retried with backoff (bounded by the job's max attempts). */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "InfraError";
  }
}

/** This worker no longer owns the job (its lease expired and was taken over). */
export class LeaseLostError extends Error {
  constructor() {
    super("Job lease lost");
    this.name = "LeaseLostError";
  }
}

export function classifyError(error: unknown): InfraError {
  if (error instanceof InfraError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new InfraError("INTERNAL_ERROR", `Unexpected worker error: ${message.slice(0, 500)}`, false);
}

/** Playwright errors that mean the browser itself went away (not a page problem). */
export function isBrowserGoneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed|Browser has been closed|browser has disconnected|Target crashed/i.test(
    message,
  );
}

/** The worker is shutting down; the job goes back to the queue. */
export class ShutdownError extends Error {
  constructor() {
    super("Worker shutting down");
    this.name = "ShutdownError";
  }
}
