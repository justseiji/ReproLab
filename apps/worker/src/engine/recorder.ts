import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "@reprolab/db";
import type { BrowserAction, ElementLocator, EvidenceKind, TriggerEvent } from "@reprolab/shared";

const MAX_EVIDENCE_PER_ATTEMPT = 200;

export interface ActionRecord {
  index: number;
  action: BrowserAction | { type: "invalid" };
  description: string;
  status: "succeeded" | "failed" | "rejected";
  error?: string | null;
  rationale?: string | null;
  locator?: ElementLocator | null;
  pageUrl?: string | null;
  triggers?: TriggerEvent[];
  screenshotId?: string | null;
  startedAt: Date;
  durationMs: number;
}

/**
 * Persists everything a run attempt produces: progress phase, timeline,
 * evidence and artifacts. Artifact files are written under
 * ARTIFACT_DIR/<runId>/attempt-<n>/ with names generated here, so no
 * user- or model-supplied text ever becomes part of a file path.
 */
export class RunRecorder {
  private pending: Promise<unknown> = Promise.resolve();
  private evidenceCount = 0;

  constructor(
    private readonly db: Db,
    readonly runId: string,
    readonly attempt: number,
    private readonly artifactDir: string,
  ) {}

  private get attemptDir(): string {
    return path.join(this.artifactDir, this.runId, `attempt-${this.attempt}`);
  }

  async phase(phase: string): Promise<void> {
    await this.db.run.update({ where: { id: this.runId }, data: { phase } });
  }

  async event(level: "info" | "warn" | "error", message: string): Promise<void> {
    await this.db.runEvent.create({ data: { runId: this.runId, level, message: message.slice(0, 1000) } });
  }

  /** Called from browser event handlers: queued so it never blocks the page. */
  evidence(kind: EvidenceKind, message: string, url: string | null): void {
    if (this.evidenceCount >= MAX_EVIDENCE_PER_ATTEMPT) return;
    this.evidenceCount += 1;
    this.pending = this.pending
      .then(() =>
        this.db.runEvidence.create({
          data: { runId: this.runId, attempt: this.attempt, kind, message: message.slice(0, 500), url: url?.slice(0, 500) ?? null },
        }),
      )
      .catch(() => {});
  }

  async action(record: ActionRecord): Promise<void> {
    await this.db.runAction.create({
      data: {
        runId: this.runId,
        attempt: this.attempt,
        index: record.index,
        type: record.action.type,
        input: record.action,
        description: record.description.slice(0, 300),
        status: record.status,
        error: record.error?.slice(0, 500) ?? null,
        rationale: record.rationale?.slice(0, 500) ?? null,
        locator: record.locator ?? undefined,
        pageUrl: record.pageUrl ?? null,
        triggers: record.triggers ?? [],
        screenshotId: record.screenshotId ?? null,
        startedAt: record.startedAt,
        durationMs: record.durationMs,
      },
    });
  }

  async saveScreenshot(index: number, image: Buffer): Promise<string> {
    const id = randomUUID();
    const fileName = `step-${String(index).padStart(2, "0")}.jpg`;
    await mkdir(this.attemptDir, { recursive: true });
    await writeFile(path.join(this.attemptDir, fileName), image);
    await this.db.artifact.create({
      data: {
        id,
        runId: this.runId,
        attempt: this.attempt,
        kind: "SCREENSHOT",
        label: `Screenshot after step ${index}`,
        relativePath: path.posix.join(this.runId, `attempt-${this.attempt}`, fileName),
        contentType: "image/jpeg",
        sizeBytes: image.length,
      },
    });
    return id;
  }

  /** Path the browser session should write its trace to. */
  async tracePath(): Promise<string> {
    await mkdir(this.attemptDir, { recursive: true });
    return path.join(this.attemptDir, "trace.zip");
  }

  async registerTrace(filePath: string): Promise<void> {
    const { size } = await stat(filePath);
    await this.db.artifact.create({
      data: {
        runId: this.runId,
        attempt: this.attempt,
        kind: "TRACE",
        label: "Playwright trace",
        relativePath: path.posix.join(this.runId, `attempt-${this.attempt}`, "trace.zip"),
        contentType: "application/zip",
        sizeBytes: size,
      },
    });
  }

  /** Waits for queued evidence writes. */
  async flush(): Promise<void> {
    await this.pending;
  }
}
