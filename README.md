[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)]
[![Made with AI](https://img.shields.io/badge/Made_with-AI_assistance-blue)]
# ReproLab

ReproLab turns a plain-language bug report into an **evidence-backed browser reproduction** and, when the bug
is confirmed, a **reviewable Playwright regression test**.

You describe a bug against the included demo store. A background worker opens an isolated browser, performs a
bounded sequence of validated actions, records screenshots, a trace, console errors and failed requests, and
checks the result against the store's written specification. Every run ends in exactly one of four outcomes:

| Outcome | Meaning |
| --- | --- |
| **Reproduced** | The described scenario happened and a specification check failed. |
| **Not reproduced** | The described scenario happened and every check passed. |
| **Inconclusive** | No trustworthy verdict: unclear expectation, steps could not be followed, budget ran out, and so on. |
| **Execution failed** | Infrastructure problem (store down, browser crash, model API error). Says nothing about the bug. |

The verdict always comes from deterministic code, never from a model's opinion. Model output can only choose
from a small, validated action vocabulary; it never becomes executable code.

> Scope: this version supports **only the included demo store**. It is a local tool with no user accounts.

## Contents

- [Quick start](#quick-start)
- [Using it](#using-it)
- [Commands](#commands)
- [Project layout](#project-layout)
- [Live AI mode](#live-ai-mode)
- [Security model and deployment](#security-model-and-deployment)
- [Known limitations](#known-limitations)
- [Next steps](#next-steps)
- Docs: [architecture](docs/architecture.md) · [module guide and design decisions](docs/guide.md) ·
  [90-second demo script](docs/demo-script.md) · [evaluation report](docs/evaluation.md)

## Quick start

**Prerequisites:** Node.js 22.12 or newer (built and tested on 24.14), npm 10+, and either Docker or a local
PostgreSQL installation (any recent version; tested with 18).

```bash
npm install
```

```bash
npx playwright install chromium
```

Create your environment file (Windows PowerShell: `Copy-Item .env.example .env`):

```bash
cp .env.example .env
```

Start PostgreSQL on `127.0.0.1:5433`. **Either** with Docker:

```bash
npm run db:up
```

**or**, without Docker, with a project-local cluster built from your installed PostgreSQL binaries (it never
touches a system-wide PostgreSQL service; set `PG_BIN` if `pg_ctl` is not found automatically):

```bash
npm run db:local
```

Create the schema and seed the three sample reports:

```bash
npm run db:setup
```

Start everything in development mode (demo store, API, worker, web UI):

```bash
npm run dev
```

Open the URL Vite prints for `[web]` (normally <http://127.0.0.1:5173>). Click **Run scripted demo** on any of
the three seeded examples. No API key is needed.

### Production build

```bash
npm run build
```

```bash
npm start
```

`npm start` runs the bundled store, API and worker. The API also serves the built UI at <http://127.0.0.1:4000>.

### Services and ports

| Service | Address | Notes |
| --- | --- | --- |
| Web UI (dev) | 127.0.0.1:5173 | Vite; proxies `/api` to the API |
| API | 127.0.0.1:4000 | Fastify; serves the UI in production |
| Demo store | localhost:4100 | The **only** origin the agent's browser may reach |
| Store admin | 127.0.0.1:4101 | Demo-only bug switches; never reachable from the agent's browser |
| PostgreSQL | 127.0.0.1:5433 | Databases `reprolab` and `reprolab_test` |

## Using it

1. **Dashboard**: three seeded examples (one per demo bug) and a table of all reports with their latest outcome.
2. **New report**: title, steps or description, expected behavior, optional actual behavior, and a mode.
   Inputs are validated with the same Zod schema on the client and the server.
3. **Run page**: live progress (polled from the database), the explicit expected outcome used as the oracle,
   the action timeline with a screenshot after every step, browser evidence, the Playwright trace, model usage,
   and, for reproduced bugs, a preview and download of the generated regression test.
4. **Demo controls**: switch each store bug between *bug enabled* and *fixed*, then re-run to see the outcome
   and the exported test change.

The three deliberate store bugs:

| Bug | Broken behavior |
| --- | --- |
| Coupon removal total | Removing a coupon hides the discount row but keeps the discounted total. |
| Quantity subtotal | Changing a quantity updates the line total but not the subtotal or total. |
| Stale cart badge | Removing the final item leaves the old count on the header badge. |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Store, API, worker and web UI with reload |
| `npm run build` / `npm start` | Production bundles / run them |
| `npm run typecheck` | `tsc` in every workspace |
| `npm test` | Unit tests, then integration tests |
| `npm run test:unit` | Pure logic only; no services needed |
| `npm run test:integration` | Real PostgreSQL (`TEST_DATABASE_URL`), real Chromium, the built store |
| `npm run eval:scripted` | Runs the 3 seeded reports in scripted mode with bugs enabled and fixed; prints outcomes and durations; saves to `eval-results/scripted/` |
| `npm run eval:live` | Same with live AI (needs `ANTHROPIC_API_KEY`, spends tokens); saves to `eval-results/live-ai/` |
| `npm run verify:regressions` | Reproduces each seeded bug, then runs the exported test with the bug enabled (must fail on an assertion) and fixed (must pass) |
| `npm run db:up` / `db:down` | Docker PostgreSQL |
| `npm run db:local` / `db:local:stop` | Project-local PostgreSQL without Docker |
| `npm run db:setup` | Migrations and seed |

The evaluation and verification commands need the demo store running (`npm run dev` or `npm start`).

## Project layout

```
apps/
  store/    Demo store: React storefront + Fastify server (public port + localhost-only admin port)
  api/      Fastify API: reports, runs, artifacts, test download, demo controls
  worker/   Queue worker: Playwright engine, scripted and live-AI planners, eval CLIs
  web/      React + Vite developer UI
packages/
  shared/   Zod schemas, store specification (the oracle), action vocabulary, URL policy,
            recipes, regression-test generator, shared response types
  db/       Prisma schema and migrations, PostgreSQL job queue, run helpers, seed
test/support/  Integration-test helpers and a fake model provider
docs/          Architecture, module guide, demo script, evaluation report
eval-results/  Saved outputs of the evaluation commands
```

## Live AI mode

Live AI mode works with four interchangeable providers. Pick one with `AI_PROVIDER` in `.env`, add its key,
and restart the API and worker (`npm run dev`):

| `AI_PROVIDER` | Key | Default model (`AI_MODEL` overrides) | Cost |
| --- | --- | --- | --- |
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | Pay per token |
| `openai` | `OPENAI_API_KEY` | `gpt-6-astra` | Pay per token |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.6-flash` | Per Google's pricing |
| `ollama` | none | `gpt-oss` | Free; runs on your computer |

For Ollama, install it from ollama.com, run `ollama pull gpt-oss` (or another model, set as `AI_MODEL`), and keep
it running. Base URLs can be overridden with `OPENAI_BASE_URL`, `GEMINI_BASE_URL` or `OLLAMA_BASE_URL`. Only the
selected provider's key is read; keys stay in the server processes and are never sent to the browser, logged,
or stored. Requests to OpenAI set `store: false`.

Every provider sits behind the same `ModelProvider` interface, so the planner, validation, evidence and verdict
logic are identical whichever model you use. Adding another provider takes one adapter file and one registry
line (see [docs/guide.md](docs/guide.md#13-model-providers-are-plug-ins)).

- The model first turns the report into an explicit expected outcome built from a fixed list of trigger events
  and specification checks, or asks a clarification question, or says the report is unsupported.
- It then picks **one validated action per step** from the elements observed on the current page.
- Output is constrained by JSON schema at the API and re-validated with Zod; actions are then checked against
  the live observation (element exists, is enabled, suits the action).
- Report and page text are treated as untrusted data (fenced, stripped of angle brackets, truncated).
- Anthropic only: `AI_EFFORT` sets reasoning effort, and requests opt in to the server-side refusal fallback
  beta (`AI_REFUSAL_FALLBACK=true`; set `false` to turn it off).
- Token usage is recorded per run. A cost estimate appears **only** when the provider reported usage **and** you
  set `AI_PRICE_INPUT_USD_PER_MTOK` and `AI_PRICE_OUTPUT_USD_PER_MTOK`.

**Status:** all four adapters are implemented and unit-tested against recorded-shape HTTP responses, and the
planner is tested end to end with a scripted fake model. **None has been run against a real model API or a real
Ollama server**, because no keys were available while building this project. See the
[evaluation report](docs/evaluation.md).

## Security model and deployment

This is a **local developer tool**. The API has no authentication and binds to `127.0.0.1` by default; the
API logs a warning if `API_HOST` is changed to something else.

What the design does enforce:

- The agent's browser can only reach the configured store origin. Every request and every redirect hop is
  checked; WebSockets, popups, downloads and service workers are blocked or closed.
- The bug switches live on a separate localhost-only admin port that the browser allowlist never includes.
- Navigation is limited to known store routes (`/`, `/cart`, `/checkout`); there is no target-URL field.
- Runs are bounded: action count, per-action timeout, model request timeout and total run time.
- Artifacts are served by ID; file paths are generated by the worker and checked to stay inside `ARTIFACT_DIR`.
- Recorded URLs drop query strings and fragments; request logs redact authorization and cookie headers.

**An internet-accessible deployment would additionally need** user authentication, per-user access control on
reports, runs and artifacts, rate limiting and quotas on run creation (each run launches a browser and may spend
model tokens), abuse monitoring, TLS, secret management, and stricter process isolation for browsers. Do not
expose the run-triggering API publicly as it is.

## Known limitations

- **One target.** Only the bundled demo store is supported; the observer and oracle rely on its test ids.
- **Narrow oracle.** Checks cover cart arithmetic and the badge. Bugs outside that (layout, copy, checkout
  validation) return Inconclusive or Unsupported rather than a verdict.
- **Final-state evaluation.** Checks run on the final page, which must be the cart. A bug that is visible only
  mid-flow and then disappears would be missed.
- **Global bug switches.** Switches apply to the whole store. Concurrent runs see the same configuration; each
  run records the switches it started with, but a switch flipped mid-run is not detected.
- **Live AI unverified against a real model.** Planner quality, latency and cost are unknown.
- **Retries restart from scratch.** A retried attempt re-runs every step; partial progress is not resumed.
- **Single machine.** Artifacts live on local disk; there is no object storage or retention policy.
- **Tested on Windows only** (Windows 10, Node 24). Docker Compose was not exercised because Docker was not
  installed; the same PostgreSQL setup was verified with the `db:local` helper.

## Next steps

1. Run `npm run eval:live` with a key, add harder reports (vague, multi-bug, prompt-injection), and record
   planner accuracy, cost and latency in `eval-results/live-ai/`.
2. Per-run store sessions (e.g. a run-scoped config token issued by the worker) so concurrent runs can use
   different bug configurations.
3. Evaluate checks after every step, not only at the end, to catch transient bugs.
4. Optional "verify this test" button that runs the exported test against both store configurations.
5. Authentication, rate limiting and object storage for artifacts before any shared deployment.
6. A second target application, with the observer and oracle extracted behind an adapter interface.
