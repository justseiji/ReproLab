-- CreateEnum
CREATE TYPE "RunMode" AS ENUM ('SCRIPTED', 'LIVE_AI');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RunOutcome" AS ENUM ('REPRODUCED', 'NOT_REPRODUCED', 'INCONCLUSIVE', 'EXECUTION_FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('SCREENSHOT', 'TRACE');

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedBehavior" TEXT NOT NULL,
    "actualBehavior" TEXT,
    "seedKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "mode" "RunMode" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "outcome" "RunOutcome",
    "reasonCode" TEXT,
    "summary" TEXT,
    "expectedOutcome" JSONB,
    "clarification" TEXT,
    "checkResults" JSONB,
    "observedTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storeConfig" JSONB,
    "regressionTest" TEXT,
    "regressionTestFileName" TEXT,
    "regressionTestNote" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunAction" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "rationale" TEXT,
    "locator" JSONB,
    "pageUrl" TEXT,
    "triggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "screenshotId" UUID,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "durationMs" INTEGER,

    CONSTRAINT "RunAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvidence" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "url" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "label" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_seedKey_key" ON "Report"("seedKey");

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE INDEX "Run_reportId_createdAt_idx" ON "Run"("reportId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunAction_runId_attempt_index_key" ON "RunAction"("runId", "attempt", "index");

-- CreateIndex
CREATE INDEX "RunEvidence_runId_idx" ON "RunEvidence"("runId");

-- CreateIndex
CREATE INDEX "Artifact_runId_idx" ON "Artifact"("runId");

-- CreateIndex
CREATE INDEX "RunEvent_runId_at_idx" ON "RunEvent"("runId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Job_runId_key" ON "Job"("runId");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAction" ADD CONSTRAINT "RunAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvidence" ADD CONSTRAINT "RunEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
