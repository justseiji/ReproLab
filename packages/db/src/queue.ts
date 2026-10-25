import type { Db } from "./client";

/**
 * A small PostgreSQL-backed job queue.
 *
 * - Claiming is atomic: `FOR UPDATE SKIP LOCKED` lets many workers poll at
 *   once without ever handing the same job to two of them.
 * - A claimed job carries a lease (`lockedUntil`). The worker renews it while
 *   it runs. If the worker dies, the lease expires and another worker
 *   reclaims the job (counted as a new attempt).
 * - Every state change after claiming is fenced on `lockedBy`, so a worker
 *   that lost its lease cannot overwrite the result of the new owner.
 */

export interface ClaimedJob {
  id: string;
  runId: string;
  attempts: number;
  maxAttempts: number;
  /** Set when the job was taken over from a worker whose lease expired. */
  previousOwner: string | null;
}

export async function claimNextJob(db: Db, workerId: string, leaseMs: number): Promise<ClaimedJob | null> {
  const rows = await db.$queryRaw<ClaimedJob[]>`
    WITH candidate AS (
      SELECT id, "lockedBy" AS previous_owner
      FROM "Job"
      WHERE ("status" = 'QUEUED' AND "runAfter" <= now())
         OR ("status" = 'RUNNING' AND "lockedUntil" < now() AND "attempts" < "maxAttempts")
      ORDER BY "runAfter", "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "Job" AS j
    SET "status" = 'RUNNING',
        "lockedBy" = ${workerId},
        "lockedUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
        "attempts" = j."attempts" + 1,
        "updatedAt" = now()
    FROM candidate
    WHERE j.id = candidate.id
    RETURNING j.id, j."runId", j."attempts", j."maxAttempts", candidate.previous_owner AS "previousOwner"`;
  return rows[0] ?? null;
}

/** Extends the lease. Returns false if this worker no longer owns the job. */
export async function renewLease(db: Db, jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
  const updated = await db.$executeRaw`
    UPDATE "Job"
    SET "lockedUntil" = now() + (${leaseMs}::int * interval '1 millisecond'), "updatedAt" = now()
    WHERE id = ${jobId}::uuid AND "lockedBy" = ${workerId} AND "status" = 'RUNNING'`;
  return updated === 1;
}

const owned = (jobId: string, workerId: string) => ({ id: jobId, lockedBy: workerId, status: "RUNNING" as const });

export async function completeJob(db: Db, jobId: string, workerId: string): Promise<boolean> {
  const { count } = await db.job.updateMany({
    where: owned(jobId, workerId),
    data: { status: "SUCCEEDED", lockedUntil: null },
  });
  return count === 1;
}

export async function failJob(db: Db, jobId: string, workerId: string, error: string): Promise<boolean> {
  const { count } = await db.job.updateMany({
    where: owned(jobId, workerId),
    data: { status: "FAILED", lockedUntil: null, lastError: error.slice(0, 2000) },
  });
  return count === 1;
}

/** Puts the job back in the queue after a transient failure, with a delay. */
export async function scheduleRetry(
  db: Db,
  jobId: string,
  workerId: string,
  error: string,
  delayMs: number,
): Promise<boolean> {
  const { count } = await db.job.updateMany({
    where: owned(jobId, workerId),
    data: {
      status: "QUEUED",
      lockedBy: null,
      lockedUntil: null,
      runAfter: new Date(Date.now() + delayMs),
      lastError: error.slice(0, 2000),
    },
  });
  return count === 1;
}

/** Returns a job to the queue during graceful shutdown. The attempt still counts. */
export async function releaseJob(db: Db, jobId: string, workerId: string): Promise<boolean> {
  const { count } = await db.job.updateMany({
    where: owned(jobId, workerId),
    data: { status: "QUEUED", lockedBy: null, lockedUntil: null, runAfter: new Date() },
  });
  return count === 1;
}

/**
 * Marks jobs whose lease expired on their final attempt as failed and returns
 * their run ids so the caller can record an execution failure on each run.
 */
export async function reapExpiredJobs(db: Db): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ runId: string }>>`
    UPDATE "Job"
    SET "status" = 'FAILED',
        "lastError" = 'Worker lease expired on the final attempt',
        "lockedBy" = NULL,
        "lockedUntil" = NULL,
        "updatedAt" = now()
    WHERE "status" = 'RUNNING' AND "lockedUntil" < now() AND "attempts" >= "maxAttempts"
    RETURNING "runId"`;
  return rows.map((r) => r.runId);
}

/** Exponential backoff for transient failures: 2s, 4s, 8s ... capped at 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}
