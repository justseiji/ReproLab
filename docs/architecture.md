# Architecture

ReproLab is a small monorepo with four processes and one database.

- The **web UI** (React) talks only to the **API**.
- The **API** (Fastify) validates input, writes reports, runs and jobs to **PostgreSQL**, and serves results.
- The **worker** claims jobs from PostgreSQL, drives an isolated **Chromium** against the **demo store**, and
  writes the timeline, evidence and outcome back to the database and artifact folder.
- The **demo store** is the system under test. Its bug switches sit on a separate, localhost-only admin port.

```mermaid
flowchart LR
  user([Developer]) --> web[Web UI<br/>React + Vite]
  web -- "/api (JSON, polling)" --> api[API<br/>Fastify]
  api -- "reports, runs, jobs" --> db[(PostgreSQL<br/>Prisma)]
  api -- "artifact files by id" --> files[(Artifact dir<br/>screenshots, traces)]
  api -. "demo-only bug switches" .-> admin[Store admin<br/>127.0.0.1:4101]

  worker[Worker<br/>queue consumer] -- "claim / lease / commit" --> db
  worker --> planner{Planner}
  planner -- scripted --> recipes[Recipes for<br/>seeded reports]
  planner -- live AI --> model[Model API<br/>Claude]
  worker -- "validated actions only" --> browser[Isolated Chromium<br/>fresh context per run]
  browser -- "allowlisted origin only" --> store[Demo store<br/>localhost:4100]
  worker -- "screenshots, trace" --> files
  worker -. "read switches as evidence" .-> admin
  admin --- store

  spec[[Store specification<br/>packages/shared]] -. oracle .-> worker
  spec -. catalog and pricing data .-> store
```

## One run, step by step

```mermaid
sequenceDiagram
  participant UI as Web UI
  participant API
  participant DB as PostgreSQL
  participant W as Worker
  participant P as Planner
  participant B as Browser
  participant S as Demo store

  UI->>API: POST /api/reports (report, mode)
  API->>API: Zod validation
  API->>DB: insert report + run + job (one transaction)
  API-->>UI: 201 { run }
  loop every second until finished
    UI->>API: GET /api/runs/:id
  end
  W->>DB: claim job (FOR UPDATE SKIP LOCKED, lease)
  W->>P: prepare(report)
  P-->>W: expected outcome (triggers + checks) or Inconclusive
  W->>S: health check (failure = transient infra error, retried)
  W->>B: launch Chromium, new context, network guard, tracing
  loop up to the action budget
    W->>B: observe page (elements, cart state)
    W->>P: next(observation, history)
    P-->>W: action | done | give up
    W->>W: validate against schema and observation
    W->>B: execute action
    W->>B: observe again, detect triggers, screenshot
    W->>DB: record action + evidence
  end
  W->>W: evaluate spec checks on final cart, decide outcome
  W->>W: generate regression test (only if Reproduced)
  W->>B: save trace, close browser (always, in finally)
  W->>DB: commit result if lease still owned
```

## Job lifecycle

```mermaid
stateDiagram-v2
  [*] --> QUEUED: API creates run + job
  QUEUED --> RUNNING: worker claims (attempts + 1, lease set)
  RUNNING --> RUNNING: heartbeat renews lease
  RUNNING --> SUCCEEDED: result committed (fenced on lockedBy)
  RUNNING --> QUEUED: transient infra error, attempts left (backoff)
  RUNNING --> QUEUED: lease expired, attempts left (another worker takes over)
  RUNNING --> QUEUED: graceful shutdown
  RUNNING --> FAILED: permanent error or final attempt failed
  RUNNING --> FAILED: lease expired on final attempt (reaper)
  SUCCEEDED --> [*]
  FAILED --> [*]
```

A run's **outcome** (Reproduced, Not reproduced, Inconclusive, Execution failed) is separate from its **job
status**. A job that `SUCCEEDED` may well have produced *Not reproduced*; a job that `FAILED` always yields
*Execution failed*.

## Data model

| Table | Purpose |
| --- | --- |
| `Report` | The submitted text. `seedKey` links seeded reports to scripted recipes. |
| `Run` | One reproduction request: mode, status, phase, outcome, expected outcome, check results, triggers, store switches at start, model usage, generated test. |
| `Job` | Queue entry for a run: status, attempts, `runAfter` (backoff), `lockedBy` / `lockedUntil` (lease). |
| `RunAction` | Timeline entries per attempt: validated action, description, locator, status, triggers, screenshot. |
| `RunEvidence` | Console errors, page errors, failed or error responses, blocked requests. |
| `Artifact` | Screenshots and traces: kind, content type, path relative to `ARTIFACT_DIR`. |
| `RunEvent` | Human-readable log: queued, claimed, retries, recovery, finished. |

All timestamps are `timestamptz` and every database session runs in UTC (see the evaluation report for the bug
that made this necessary).

## Trust boundaries

| Boundary | Enforcement |
| --- | --- |
| User → API | Zod schemas, strict objects (unknown keys rejected), length limits, 64 KB body limit, UUID ids |
| Model → worker | JSON schema at the API, Zod re-validation, then a check against the current observation |
| Worker → browser | Five action types; navigation only to three store routes; no `evaluate` of planner output |
| Browser → network | Origin allowlist on every request and redirect hop; WebSockets, popups, downloads, service workers blocked |
| Planner → verdict | None: outcomes come from `decideOutcome()` over observed state and the store specification |
| Generated test → disk | Fixed templates; dynamic values only as `JSON.stringify` string literals |
| API → files | Artifact lookup by id; resolved path must stay inside `ARTIFACT_DIR` |
