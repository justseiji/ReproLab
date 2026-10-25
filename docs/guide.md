# Module guide and design decisions

This guide is a reading order for the code plus the reasoning behind the main decisions.

## Suggested reading order

1. `packages/shared/src/store-spec.ts`: what the store is *supposed* to do.
2. `packages/shared/src/oracle.ts`: how a run is judged. This is the heart of the project.
3. `packages/shared/src/actions.ts`: the only things a planner can ask the browser to do.
4. `apps/worker/src/engine/reproduce.ts`: the loop that ties planning, execution, evidence and evaluation together.
5. `packages/db/src/queue.ts` and `apps/worker/src/worker.ts`: how jobs are claimed, kept alive and committed.
6. `apps/worker/src/planners/`: the scripted and live AI planners behind one interface.
7. `packages/shared/src/testgen.ts`: how a regression test is produced from the trace.

## Modules

### `packages/shared`: the domain core (browser- and Node-safe)

| File | Responsibility |
| --- | --- |
| `store-spec.ts` | Catalog, coupons, pricing rules, `computeExpectedCart()` reference model, money formatting, test ids, bug descriptions |
| `oracle.ts` | Trigger events, specification checks, `detectTriggers()`, `evaluateChecks()`, `decideOutcome()` |
| `actions.ts` | Zod action vocabulary and `checkActionAgainstObservation()` (the second validation gate) |
| `report.ts` | Report and request schemas, run modes and outcome labels |
| `url-policy.ts` | Origin allowlist check used by the network guard |
| `recipes.ts`, `seed-data.ts` | The three seeded reports and their scripted recipes |
| `testgen.ts` | Template-based Playwright test generation |
| `config.ts` (via `@reprolab/shared/node`) | Environment parsing and validation for API and worker |

### `packages/db`: persistence and the queue

Prisma schema, migrations and a small queue built on PostgreSQL row locks. `queue.ts` has the claim, lease,
retry and reap logic; `runs.ts` has the transactional "create run + job" helper used by the API.

### `apps/store`: the system under test

- `src/cart.ts` is the store's own cart reducer. Like many real carts it stores denormalized totals and
  updates them in each handler; each bug flag skips one recalculation. It deliberately does **not** use the
  spec's pricing functions, so the spec stays an independent oracle.
- `server/app.ts` runs two Fastify servers that share the in-memory bug switches: the public storefront and
  API, and the admin server bound to `127.0.0.1`.

### `apps/worker`: the reproduction engine

| Path | Responsibility |
| --- | --- |
| `worker.ts` | Poll loop, concurrency limit, lease heartbeat, fenced commit, retry and failure classification, graceful shutdown |
| `engine/reproduce.ts` | One attempt: prepare → preflight → launch → bounded loop → evaluate → test generation → cleanup |
| `engine/browser-session.ts` | Chromium launch, isolated context, evidence listeners, action execution, bounded close |
| `engine/network-guard.ts` | Per-request and per-redirect origin enforcement, WebSocket blocking |
| `engine/observe.ts` | Fixed in-page script that lists interactive elements and reads cart state via test ids |
| `engine/recorder.ts` | Writes phase, timeline, evidence and artifacts; generates artifact file names itself |
| `planners/scripted.ts`, `planners/live-ai.ts` | Two implementations of the `Planner` interface |
| `ai/` | Provider interface and registry, shared HTTP and schema helpers, Anthropic/OpenAI/Gemini/Ollama adapters, output schemas, prompts |
| `regression/run-test.ts` | Runs an exported test with the real Playwright runner and classifies the result |
| `cli/eval.ts`, `cli/verify-regressions.ts` | Evaluation commands |

### `apps/api` and `apps/web`

The API is thin on purpose: validate, write, read, map rows to DTOs (`dto.ts`), serve files safely. The web
UI uses plain React state plus a `useResource` hook that polls while a run is active. There is no global
state library, because the data is server-owned and short-lived.

## Design decisions

### 1. The specification is an executable oracle, and inputs are trusted over outputs

A failing run must be explainable without trusting anyone's opinion, including a model's. The oracle reads
the cart's **inputs** from the page (product ids, quantities, applied coupon), computes what the outputs
*should* be with the reference model, and compares them to the **displayed outputs** (line totals, subtotal,
discount, total, badge). Displayed totals are never used to compute expectations, so a stale subtotal cannot
make itself look correct.

*Trade-off:* the oracle only knows cart arithmetic. Anything outside it ends Inconclusive or Unsupported
instead of guessing.

### 2. "Not reproduced" requires proof that the scenario actually happened

An agent that gives up early would otherwise produce false "Not reproduced" verdicts. Each expected outcome
lists **trigger events** (`coupon_removed`, `quantity_changed`, `cart_emptied`, ...) that are detected
automatically by diffing consecutive cart observations. If any required trigger was never observed, the run
is Inconclusive, whatever the planner claims. This is covered by an integration test where a fake model
declares "done" immediately.

### 3. One loop for both modes

Scripted recipes and the live model implement the same `Planner` interface and produce the same `BrowserAction`
values. Recipe steps name elements by test id and are resolved against the live observation, so a recipe step
goes through the same two validation gates as model output. Execution, evidence capture, evaluation and storage
are shared. This keeps the scripted demo honest: it exercises the real engine, not a mock.

### 4. Recipes are bound by seed key, never by text matching

Scripted mode only has recipes for the three seeded reports. A new report, even one whose text is identical to
a seeded one, gets `SCRIPTED_RECIPE_UNAVAILABLE`: "live AI mode is required." Matching on text would silently
substitute a recipe for a report it was not written for.

### 5. Two validation gates for every action

Gate 1 is the Zod vocabulary: five action types with strict objects, no extra keys, routes from a fixed list,
bounded strings. Gate 2 is `checkActionAgainstObservation()`: the element id must exist in the **current**
observation, be enabled, have a stable locator, and suit the action (only text inputs can be filled, only listed
options selected). Rejected actions are recorded in the timeline and count against the budget.

### 6. Untrusted text stays data

Report text and page text are fenced in tags, stripped of `<` and `>` (so they cannot close or forge the tags),
and truncated. The system prompt says they are data. The real protection is structural, though: even a fully
manipulated model can only emit validated actions on the allowed origin, and it cannot influence the verdict.

### 7. Regression tests come from templates, and assert the spec rather than the observation

`testgen.ts` emits a fixed set of statements. Dynamic values (test ids, fill values, the title) are inserted
only via `JSON.stringify`, which makes them string literals. A unit test feeds hostile strings through it and
parses the result. Assertions use **specification values computed from the final inputs** (for example,
`toHaveText("$24.00")`), never the faulty value seen during the run, which is why the test fails while the bug
exists and passes once it is fixed. `verify:regressions` checks the failure happens *on an assertion*, so a
test that merely crashes is not counted as "failing for the right reason."

### 8. A PostgreSQL queue instead of Redis

The project already needs PostgreSQL, and this workload is a few long jobs, not millions of short ones.

- **Claiming** uses `SELECT ... FOR UPDATE SKIP LOCKED` inside an `UPDATE`, so concurrent workers never take
  the same job (tested with 8 concurrent claimers and 25 jobs).
- **Leases**: a claimed job has `lockedUntil`; the worker renews it every third of the lease. If a worker dies,
  the lease expires and another worker takes over, counting a new attempt.
- **Fencing**: every state change after claiming includes `lockedBy = me`. A worker that lost its lease cannot
  overwrite the new owner's result (tested).
- **Retries**: only *transient infrastructure* errors (store unreachable, browser crash) are retried, with
  exponential backoff, up to `JOB_MAX_ATTEMPTS`. Model API errors are not retried at the job level: the SDK
  already retried them, and re-running the whole job would spend tokens again.
- **Reaping**: jobs whose lease expires on the final attempt are marked failed and their runs get
  `Execution failed: WORKER_LOST`.

### 9. Infrastructure failures are a separate outcome

`InfraError` carries a reason code and a `transient` flag. Anything that prevents the run from happening
(store down, browser missing or crashed, model API failure, missing API key) ends as **Execution failed**,
never as Not reproduced. Budget exhaustion and failed steps are **Inconclusive**: the run happened, but no
verdict is justified.

### 10. Isolation and cleanup

Each attempt launches its own Chromium with a fresh context (no storage, service workers blocked, fixed locale
and time zone), so runs cannot leak cart state into each other. The store keeps its cart in `localStorage`, so
every run starts empty. `browser.close()` runs in `finally` and is bounded by a timeout; the trace is saved
best-effort first.

### 11. Bug switches outside the agent's reach

The switches are on a second Fastify server bound to `127.0.0.1:4101`. The browser allowlist contains only the
storefront origin, so the agent cannot reach the switches even if it tried. The worker reads the switches
(from Node, not the browser) only to record them as evidence on the run page; the evaluator never reads them.

### 12. Workspace packages are TypeScript source

Internal packages export `.ts` files directly. tsx, Vite and Vitest consume them as-is; `tsconfig` `paths` and
the Vite/Vitest aliases point at the same sources; production Node bundles are built with esbuild
(`scripts/build-node.mjs`), which inlines workspace code and keeps npm dependencies external. There is no
per-package build step to keep in sync.

### 13. Model providers are plug-ins

The planner depends on one interface, `ModelProvider.generate(system, user, schema)`, which returns a validated
object and token usage. Four adapters implement it (`apps/worker/src/ai/providers/`): Anthropic through its
official SDK, and OpenAI, Gemini and Ollama through their REST APIs. The REST adapters share two pieces:

- `ai/http.ts` posts JSON with a per-attempt timeout, two retries with backoff for 408/429/5xx and network
  errors, cancellation from the run deadline, and one error classification (auth, rate limit, unavailable, bad
  request). Error messages never include headers, so keys cannot leak into run records.
- `ai/json-schema.ts` converts the Zod schema to the strictest common JSON Schema subset: an object root (OpenAI
  forbids a union at the root, so the output is wrapped as `{ "result": ... }`), `anyOf` instead of `oneOf`,
  enums instead of `const`, and no length or numeric limits. The reply is still validated with the original Zod
  schema, so nothing is lost; the provider's constrained decoding is just a first filter.

`ai/registry.ts` maps `AI_PROVIDER` to a factory, and `packages/shared/src/ai-providers.ts` holds each
provider's default model, key variable and base URL. Adding a provider means one adapter file, one registry line
and one metadata entry. Nothing in the engine, validation or UI changes, and a model can never influence the
verdict, whichever vendor it comes from.

## Questions an interviewer might ask

- **Why not let the model say whether the bug reproduced?** Its explanation is not evidence. The verdict comes
  from observed state compared with a written specification, and every input to that decision is shown on the
  run page.
- **What happens if two workers grab the same job?** They cannot: `SKIP LOCKED` hands each row to one
  transaction. If a worker stalls and loses its lease, fencing stops it from committing.
- **How would you add a second target app?** Extract the observer (`observe.ts`) and the oracle into an adapter
  interface per target, and make the action vocabulary's routes per-target configuration.
- **What would you change for production?** See "Security model and deployment" and "Next steps" in the README.
