# Evaluation report

Every number here comes from commands that were actually run while building the project. Nothing is
estimated or extrapolated. Live AI mode was **not** evaluated against a real model (see the end of this report).

**Environment:** Windows 10 Pro (10.0.19045), Node.js 24.14.0, Playwright 1.64.1 with headless Chromium,
PostgreSQL 18.6 started with `npm run db:local` (Docker was not installed, so `docker compose` was not exercised),
TypeScript 7.0.2, Vitest 5.0.5. Run on 2026-10-25.

## Summary

| Check | Command | Result |
| --- | --- | --- |
| Type checking (all 6 workspaces) | `npm run typecheck` | Pass |
| Production build (store, web, API, worker) | `npm run build` | Pass |
| Unit tests | `npm run test:unit` | 73 / 73 passed |
| Integration tests | `npm run test:integration` | 33 / 33 passed (about 78 s) |
| Scripted evaluation | `npm run eval:scripted` | 6 / 6 outcomes as expected |
| Exported regression tests | `npm run verify:regressions` | 3 / 3 fail on an assertion with the bug, pass when fixed |
| Live AI evaluation | `npm run eval:live` | Not run as a full evaluation; one real Gemini run is reported below |

The bundled production processes (`npm start`) and the development stack (`npm run dev`) were also started
and used: a scripted run queued through the production API was processed by the bundled worker and finished
as *Reproduced*, and the dev UI loaded through the Vite proxy with no console errors.

## Scripted evaluation (`eval-results/scripted/latest.json`)

Each seeded report was run in scripted mode twice: with every store bug enabled (expected: Reproduced) and with
every bug fixed (expected: Not reproduced). Durations are measured from the run's first claim to its committed
result, including browser launch and the trace.

| Report | Store | Expected | Actual | Reason | Run time | Actions | Test generated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| coupon-removal-total | bugs enabled | Reproduced | Reproduced | CHECK_FAILED | 2,445 ms | 7 | yes |
| quantity-subtotal | bugs enabled | Reproduced | Reproduced | CHECK_FAILED | 2,078 ms | 5 | yes |
| stale-cart-badge | bugs enabled | Reproduced | Reproduced | CHECK_FAILED | 2,013 ms | 5 | yes |
| coupon-removal-total | bugs fixed | Not reproduced | Not reproduced | CHECKS_PASSED | 2,415 ms | 7 | no |
| quantity-subtotal | bugs fixed | Not reproduced | Not reproduced | CHECKS_PASSED | 2,091 ms | 5 | no |
| stale-cart-badge | bugs fixed | Not reproduced | Not reproduced | CHECKS_PASSED | 2,051 ms | 5 | no |

All six runs finished on their first attempt. This is a check that the deterministic pipeline is correct for
the cases it was built for. It is **not** an accuracy benchmark: scripted mode replays known recipes against
known bugs.

## Exported regression tests (`eval-results/regression-tests/`)

For each seeded bug, the bug was reproduced in scripted mode, and the exported test was run twice with the real
Playwright test runner. A run only counts as "failing with the bug" when the failure is an `expect(...)`
assertion. A crash or a "no tests found" error does not count.

| Report | With bug enabled | After fix | First failure message with the bug |
| --- | --- | --- | --- |
| coupon-removal-total | assertion failed (7,600 ms) | passed (2,468 ms) | `expect(locator).toHaveText(expected) failed` |
| quantity-subtotal | assertion failed (7,320 ms) | passed (2,350 ms) | `expect(locator).toHaveText(expected) failed` |
| stale-cart-badge | assertion failed (7,538 ms) | passed (2,129 ms) | `expect(locator).toBeHidden() failed` |

The failing runs take longer because Playwright retries assertions until its default 5-second timeout. The
three generated test files are saved next to the results for review.

## Live AI spot check: Google Gemini (2026-10-25)

One seeded report was run in live AI mode with a real Gemini API key (`AI_PROVIDER=gemini`, model
`gemini-3.6-flash`). This is a single run, not an accuracy measurement.

| Report | Outcome | Run time | Model calls | Tokens (in / out) | Steps | Exported test with bug / fixed |
| --- | --- | --- | --- | --- | --- | --- |
| coupon-removal-total | Reproduced (CHECK_FAILED, expected $24.00, observed $21.60) | 42.2 s | 8 | 9,393 / 1,573 | 6, all succeeded | assertion failed / passed |

The model chose the triggers `item_added`, `coupon_applied` and `coupon_removed` and the checks
`discount_matches_spec` and `total_matches_spec` on its own. Getting there surfaced three issues, all handled:

- **Model choice.** `gemini-2.5-flash` is no longer offered to new keys (HTTP 404). `gemini-3.8-flash` worked
  but took about 28 s for a one-word reply, too slow for a 10-call run inside the 2-minute limit (the first
  attempt ended *Inconclusive, BUDGET_EXHAUSTED* with no completed call). `gemini-3.6-flash` answered in about
  3.6 s and is now the Gemini default.
- **Rate limits.** The key's per-minute quota was hit after about 6 calls; the run correctly ended *Execution
  failed: AI_PROVIDER_ERROR* rather than claiming anything about the bug. Retries now wait as long as the server
  asks (`Retry-After` or Google's `retryDelay`, capped at 30 s).
- **Missing test ids.** The header Cart link had no test id, so its computed accessible name ("Cart1") did not
  match Playwright's, and one click failed (the model recovered by navigating). All store links and buttons now
  have test ids.

## Test inventory

### Unit tests (73, no services)

| File | Tests | Covers |
| --- | --- | --- |
| `packages/shared/test/validation.unit.test.ts` | 10 | Report validation messages, unknown keys, control characters; action vocabulary rejects `evaluate`, URLs, unknown routes, extra keys, over-long values; validation against the observation (missing, disabled, unlocatable elements; fill and select rules) |
| `packages/shared/test/url-policy.unit.test.ts` | 4 | Origin allowlist: other ports (including the admin port), hosts, schemes (`file:`, `data:`, `javascript:`, `ws:`), userinfo and look-alike host tricks |
| `packages/shared/test/store-spec.unit.test.ts` | 6 | Line totals, subtotal, SAVE10 rounding, WELCOME5 threshold, unknown coupons and products, money formatting and parsing |
| `packages/shared/test/oracle.unit.test.ts` | 12 | Trigger detection; checks use inputs, not displayed totals; outcome rules (Reproduced, Not reproduced, missing trigger, failed step, budget, not evaluable) |
| `packages/shared/test/testgen.unit.test.ts` | 4 | Asserts spec values, not observed values; hostile strings stay string literals and the output parses; refuses without a failing check or a stable locator |
| `apps/store/test/cart.unit.test.ts` | 8 | Fixed store matches the spec on the seeded scenarios and on 200 seeded-random action sequences; each bug produces exactly its described symptom and only in its own scenario |
| `apps/worker/test/providers.unit.test.ts` | 18 | OpenAI, Gemini and Ollama adapters against a fake `fetch`: request shape (URL, auth header, schema, `store: false`), parsing, usage, refusals, truncation, retry on 429, no key in error messages, missing Ollama model, unreachable server; generated schemas meet strict-mode rules; provider selection reads only the chosen key and model defaults |
| `apps/worker/test/planners.unit.test.ts` | 11 | Live AI planner with a fake provider: clarification, invented checks rejected, out-of-vocabulary actions, repeated invalid output, provider errors become infrastructure errors, cost only with usage and prices; prompt fencing; scripted planner refuses unknown reports and resolves steps against the observation |

### Integration tests (33, real PostgreSQL, real Chromium, built store)

| File | Tests | Covers |
| --- | --- | --- |
| `packages/db/test/queue.int.test.ts` | 6 | 8 concurrent claimers × 25 jobs: each claimed exactly once; valid leases block claims; expired lease takeover; fencing of the old owner; retry backoff; reaping on the final attempt |
| `apps/worker/test/network-guard.int.test.ts` | 4 | Two real servers. Sub-resource and `fetch` to another origin blocked; direct navigation blocked; redirect to another origin blocked; same-origin redirect allowed. The "outside" server received zero requests. |
| `apps/worker/test/workflow.int.test.ts` | 9 | End-to-end reproduction with evidence files on disk; Not reproduced when fixed; no recipe → Inconclusive; unreachable store → retry → Execution failed; crashed worker recovered by another; live AI without a key; live AI with a fake model (a hostile action rejected, oracle decides); the model's "done" without the trigger → Inconclusive; run time limit |
| `apps/worker/test/regression-tests.int.test.ts` | 3 | The regression-test property for each seeded bug, as above |
| `apps/api/test/api.int.test.ts` | 11 | Validation envelope and field paths; malformed JSON; report + run + job created together; live AI refused (409) without a key and nothing saved; config doesn't leak the key; 400 vs 404 ids; artifact path-escape attempt returns 404; test download headers; demo controls and 502 when the store is down |

## Problems found by verification and fixed

These were real defects that the tests or manual checks caught during the build:

1. **Lease and backoff times off by the server's UTC offset.** Prisma's default `DateTime` column is
   `timestamp without time zone`, and the pg driver adapter sends dates as UTC wall-clock text. The queue
   compares against SQL `now()`, so on a server not running in UTC (this one was +08:00) retry delays and leases
   were wrong by hours. The queue retry test failed. Fix: `timestamptz` columns and UTC database sessions.
2. **Crashed tests counted as "failing correctly".** The first regression runner treated any non-zero exit as
   "the test failed with the bug". A run that failed only because `@playwright/test` couldn't be imported would
   have passed verification. Fix: the runner reads Playwright's JSON report and requires an `expect(...)`
   assertion failure.
3. **Two copies of the Playwright test library.** When launched through npm on this machine, the runner and the
   generated test resolved `@playwright/test` through different paths ("did not expect test() to be called
   here"). Fix: resolve the runner from the test's own directory.
4. **Run duration recorded as 0 ms** on first attempts (computed from a stale `startedAt`). Fixed; the affected
   evaluation output was discarded.
5. **Fastify crashed at startup when serving the built UI** (a second not-found handler). Fixed by folding the
   SPA fallback into the shared error handling.
6. **Horizontal overflow at 375 px** on the run page caused by the code preview widening the grid. Fixed with
   `minmax(0, 1fr)` columns.

## What was not verified

- **Live AI mode beyond one Gemini run.** Anthropic, OpenAI and Ollama have not been run against a real API or
  server, and Gemini only on the single report above. No keys for the others and no Ollama installation were
  available. The OpenAI, Gemini and Ollama adapters were written against each vendor's current
  documentation (checked on 2026-10-25) and tested only against mocked HTTP responses, so a real API may still
  reject a request field; the error would show on the run as `AI_PROVIDER_ERROR` with the vendor's message.
  For Anthropic specifically: no API key was available. The Claude adapter type-checks against the
  installed SDK (`@anthropic-ai/sdk` 1.3.0) and the planner logic is tested with a scripted fake provider that
  validates output the same way, but real planning quality, latency, token usage and cost are unmeasured. The
  request uses Anthropic's server-side refusal fallback beta, which is also untested here. If the API rejects
  it, set `AI_REFUSAL_FALLBACK=false`.
- **Docker Compose.** Docker was not installed. The same PostgreSQL configuration (port 5433, both databases)
  was verified with `npm run db:local`.
- **Other operating systems.** Only Windows 10 was used.
- **Concurrency under load.** The queue's correctness under concurrent claims is tested; throughput with
  several workers and many browsers was not measured.
- **Accessibility.** Submitting the report form with the keyboard and focus moving to the error summary were
  checked by hand. The skip link, the screenshot dialog and screen-reader output were not tested, and no
  automated accessibility audit was run. Layout was checked at 375 px width (no horizontal scrolling).

## Reproducing this report

With PostgreSQL running and the store started (`npm run dev` or `npm start`):

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run eval:scripted
```

```bash
npm run verify:regressions
```
