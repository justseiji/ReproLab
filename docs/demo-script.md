# 90-second demo script

**Before you start:** run `npm run dev` (or `npm start`), open the UI, set every switch on **Demo controls** to
*Bug enabled*, and keep a second tab open on the demo store at <http://localhost:4100>.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:10 | Dashboard | "ReproLab takes a plain-language bug report, tries to reproduce it in a real browser, and only claims success when deterministic checks prove it." |
| 0:10–0:20 | Click **Run scripted demo** on *Removing a coupon leaves the discounted total* | "This seeded report says: add the tote, apply SAVE10, remove it. The total should go back to $24." |
| 0:20–0:35 | Run page while it runs | "Progress comes straight from the database. A worker claimed the job from a Postgres queue and launched an isolated Chromium that can only reach the store's origin. Every step is validated against the elements actually on the page." |
| 0:35–0:50 | Outcome card, then the **Expected outcome** panel | "Reproduced. The verdict isn't an opinion: the required triggers, coupon applied and removed, were observed, and the spec check failed. Expected $24.00, the page shows $21.60." |
| 0:50–1:00 | Timeline: open one screenshot | "Each step has a screenshot, a locator and a duration, and the full Playwright trace is downloadable." |
| 1:00–1:12 | Scroll to **Regression test** | "Because the bug is confirmed and the expectation is clear, it generates a Playwright test from fixed templates. Note it asserts $24.00, the specified value, not what we observed." |
| 1:12–1:25 | **Demo controls**: switch *Coupon removal total* to Fixed, go back to the report, **Run scripted demo** | "Now I fix the bug and re-run." |
| 1:25–1:30 | Outcome: **Not reproduced** | "Same steps, every check passes. And `npm run verify:regressions` proves each exported test fails with its bug and passes once it's fixed." |

## Optional extras (if you have more time)

- **Honesty in scripted mode:** on *New report*, click a "Fill with an example" button and submit in scripted
  mode. The run ends **Inconclusive**, "live AI mode is required," because recipes are bound to seeded reports,
  never guessed from text.
- **Infrastructure vs. bug:** stop the store and run an example. The run retries with backoff, then ends
  **Execution failed: STORE_UNAVAILABLE**, not "Not reproduced."
- **Live AI:** with `ANTHROPIC_API_KEY` set, run the same example with **Run with live AI**. Show the planner's
  rationale under each step and the token usage card.
