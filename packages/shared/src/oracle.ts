import { z } from "zod";
import type { CartObservation } from "./observation";
import type { RunOutcome } from "./report";
import { computeExpectedCart, findProduct, formatMoney, type ExpectedCart } from "./store-spec";

/**
 * The oracle decides outcomes deterministically. A run's expected outcome is
 * an explicit, structured object: the trigger events the report describes and
 * the specification checks that must hold afterwards. Neither a recipe nor the
 * model can declare "reproduced"; only failing checks after observed triggers can.
 */

export const TRIGGER_EVENTS = [
  "item_added",
  "quantity_changed",
  "item_removed",
  "cart_emptied",
  "coupon_applied",
  "coupon_removed",
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const TRIGGER_DESCRIPTIONS: Record<TriggerEvent, string> = {
  item_added: "An item was added to the cart",
  quantity_changed: "A cart line's quantity changed",
  item_removed: "A cart line was removed",
  cart_emptied: "The cart went from non-empty to empty",
  coupon_applied: "A coupon was applied",
  coupon_removed: "An applied coupon was removed",
};

export const ORACLE_CHECKS = [
  "line_totals_match_spec",
  "subtotal_matches_spec",
  "discount_matches_spec",
  "total_matches_spec",
  "badge_matches_cart",
] as const;
export type OracleCheck = (typeof ORACLE_CHECKS)[number];

export const CHECK_DESCRIPTIONS: Record<OracleCheck, string> = {
  line_totals_match_spec: "Each line total equals unit price × quantity",
  subtotal_matches_spec: "Subtotal equals the sum of line totals",
  discount_matches_spec: "Discount matches the applied coupon's rule (no coupon → no discount)",
  total_matches_spec: "Total equals subtotal minus discount",
  badge_matches_cart: "Header badge equals the total item quantity (hidden when empty)",
};

export const ExpectedOutcomeSchema = z.strictObject({
  summary: z.string().trim().min(5).max(300),
  triggers: z.array(z.enum(TRIGGER_EVENTS)).min(1).max(6),
  checks: z.array(z.enum(ORACLE_CHECKS)).min(1).max(5),
});
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;

// ---------------------------------------------------------------------------
// Trigger detection: compare consecutive cart observations.
// ---------------------------------------------------------------------------

export function detectTriggers(prev: CartObservation, next: CartObservation): TriggerEvent[] {
  const events = new Set<TriggerEvent>();

  if (prev.lines && next.lines) {
    const before = new Map(prev.lines.map((l) => [l.productId, l]));
    const after = new Map(next.lines.map((l) => [l.productId, l]));
    for (const [id, line] of after) {
      const old = before.get(id);
      if (!old) events.add("item_added");
      else if (old.quantity !== line.quantity) events.add("quantity_changed");
    }
    for (const id of before.keys()) if (!after.has(id)) events.add("item_removed");
    if (prev.lines.length > 0 && next.lines.length === 0) events.add("cart_emptied");
  } else if (next.badgeCount > prev.badgeCount) {
    // Off the cart page only the header badge is visible.
    events.add("item_added");
  }

  if (prev.onCartPage && next.onCartPage) {
    if (next.couponCode && next.couponCode !== prev.couponCode) events.add("coupon_applied");
    if (prev.couponCode && !next.couponCode) events.add("coupon_removed");
  }
  return [...events];
}

// ---------------------------------------------------------------------------
// Specification checks on the final observation.
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "not_evaluable";

export interface CheckResult {
  check: OracleCheck;
  status: CheckStatus;
  expected: string;
  observed: string;
  detail: string;
}

const shown = (cents: number | null) => (cents === null ? "not shown" : formatMoney(cents));

/**
 * Builds the reference cart from the *inputs* visible on the page (product ids,
 * quantities, applied coupon). Outputs such as subtotal are never trusted.
 */
export function expectedCartFromObservation(cart: CartObservation): ExpectedCart | { error: string } {
  if (!cart.onCartPage || cart.lines === null) {
    return { error: "The final page is not the cart page, so cart totals are not visible." };
  }
  for (const line of cart.lines) {
    if (!findProduct(line.productId)) return { error: `Unknown product "${line.productId}" in the cart.` };
    if (line.quantity === null) return { error: `Could not read the quantity for "${line.productId}".` };
  }
  return computeExpectedCart(
    cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity ?? 0 })),
    cart.couponCode,
  );
}

export function evaluateChecks(cart: CartObservation, checks: readonly OracleCheck[]): CheckResult[] {
  const expected = expectedCartFromObservation(cart);
  if ("error" in expected) {
    return checks.map((check) => ({ check, status: "not_evaluable", expected: "—", observed: "—", detail: expected.error }));
  }
  const lines = cart.lines ?? [];
  const empty = expected.lines.length === 0;

  return checks.map((check): CheckResult => {
    switch (check) {
      case "line_totals_match_spec": {
        const wrong = expected.lines.filter((e) => lines.find((l) => l.productId === e.productId)?.lineTotalCents !== e.lineTotalCents);
        return {
          check,
          status: wrong.length === 0 ? "pass" : "fail",
          expected: expected.lines.map((l) => `${l.productId}: ${formatMoney(l.lineTotalCents)}`).join(", ") || "no lines",
          observed: lines.map((l) => `${l.productId}: ${shown(l.lineTotalCents)}`).join(", ") || "no lines",
          detail: wrong.length === 0 ? "All line totals match." : `Wrong line total for ${wrong.map((w) => w.productId).join(", ")}.`,
        };
      }
      case "subtotal_matches_spec": {
        const ok = empty ? cart.subtotalCents === null || cart.subtotalCents === 0 : cart.subtotalCents === expected.subtotalCents;
        return {
          check,
          status: ok ? "pass" : "fail",
          expected: empty ? "hidden (empty cart)" : formatMoney(expected.subtotalCents),
          observed: shown(cart.subtotalCents),
          detail: ok ? "Subtotal matches the sum of line totals." : "Subtotal does not equal the sum of line totals.",
        };
      }
      case "discount_matches_spec": {
        const observed = cart.discountCents === null ? 0 : Math.abs(cart.discountCents);
        const ok = observed === expected.discountCents;
        return {
          check,
          status: ok ? "pass" : "fail",
          expected: expected.discountCents === 0 ? "no discount" : formatMoney(-expected.discountCents),
          observed: cart.discountCents === null ? "no discount" : formatMoney(-observed),
          detail: ok
            ? "Discount matches the coupon rule."
            : `Discount should follow ${cart.couponCode ? `coupon ${cart.couponCode}` : "no coupon (zero discount)"}.`,
        };
      }
      case "total_matches_spec": {
        const ok = empty ? cart.totalCents === null || cart.totalCents === 0 : cart.totalCents === expected.totalCents;
        return {
          check,
          status: ok ? "pass" : "fail",
          expected: empty ? "hidden (empty cart)" : formatMoney(expected.totalCents),
          observed: shown(cart.totalCents),
          detail: ok ? "Total equals subtotal minus discount." : "Total does not equal subtotal minus discount.",
        };
      }
      case "badge_matches_cart": {
        const observed = cart.badgeVisible ? cart.badgeCount : 0;
        const ok = observed === expected.itemCount;
        return {
          check,
          status: ok ? "pass" : "fail",
          expected: expected.itemCount === 0 ? "hidden (0 items)" : String(expected.itemCount),
          observed: cart.badgeVisible ? String(cart.badgeCount) : "hidden",
          detail: ok ? "Badge matches the cart quantity." : "Badge does not match the number of items in the cart.",
        };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Outcome decision.
// ---------------------------------------------------------------------------

export type StopReason =
  | "completed"
  | "step_failed"
  | "planner_gave_up"
  | "budget_exhausted"
  | "navigation_blocked";

export type ReasonCode =
  | "CHECK_FAILED"
  | "CHECKS_PASSED"
  | "NEEDS_CLARIFICATION"
  | "UNSUPPORTED_REPORT"
  | "SCRIPTED_RECIPE_UNAVAILABLE"
  | "STEP_FAILED"
  | "PLANNER_GAVE_UP"
  | "BUDGET_EXHAUSTED"
  | "NAVIGATION_BLOCKED"
  | "TRIGGER_NOT_OBSERVED"
  | "CHECK_NOT_EVALUABLE"
  | "STORE_UNAVAILABLE"
  | "BROWSER_FAILED"
  | "AI_NOT_CONFIGURED"
  | "AI_PROVIDER_ERROR"
  | "WORKER_LOST"
  | "INTERNAL_ERROR";

export interface OutcomeDecision {
  outcome: RunOutcome;
  reasonCode: ReasonCode;
  summary: string;
  checkResults: CheckResult[];
  missingTriggers: TriggerEvent[];
}

export interface DecideOutcomeInput {
  expected: ExpectedOutcome;
  stopReason: StopReason;
  stopDetail?: string;
  observedTriggers: ReadonlySet<TriggerEvent>;
  finalCart: CartObservation;
}

export function decideOutcome(input: DecideOutcomeInput): OutcomeDecision {
  const checkResults = evaluateChecks(input.finalCart, input.expected.checks);
  const missingTriggers = input.expected.triggers.filter((t) => !input.observedTriggers.has(t));
  const base = { checkResults, missingTriggers };
  const detail = input.stopDetail ? ` ${input.stopDetail}` : "";

  if (input.stopReason !== "completed") {
    const map = {
      step_failed: ["STEP_FAILED", "A reproduction step could not be performed."],
      planner_gave_up: ["PLANNER_GAVE_UP", "The planner could not find a way to follow the report."],
      budget_exhausted: ["BUDGET_EXHAUSTED", "The run used its action or time budget before finishing."],
      navigation_blocked: ["NAVIGATION_BLOCKED", "The browser tried to leave the allowed store origin."],
    } as const;
    const [reasonCode, message] = map[input.stopReason];
    return { ...base, outcome: "INCONCLUSIVE", reasonCode, summary: `${message}${detail}` };
  }
  if (missingTriggers.length > 0) {
    return {
      ...base,
      outcome: "INCONCLUSIVE",
      reasonCode: "TRIGGER_NOT_OBSERVED",
      summary: `The run never observed the scenario the report describes (missing: ${missingTriggers.join(", ")}).`,
    };
  }
  const notEvaluable = checkResults.filter((r) => r.status === "not_evaluable");
  if (notEvaluable.length > 0) {
    return {
      ...base,
      outcome: "INCONCLUSIVE",
      reasonCode: "CHECK_NOT_EVALUABLE",
      summary: `Expected behavior could not be checked: ${notEvaluable[0]?.detail}`,
    };
  }
  const failed = checkResults.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    const first = failed[0]!;
    return {
      ...base,
      outcome: "REPRODUCED",
      reasonCode: "CHECK_FAILED",
      summary: `Reproduced. Check failed: "${CHECK_DESCRIPTIONS[first.check]}" (expected ${first.expected}, observed ${first.observed}).`,
    };
  }
  return {
    ...base,
    outcome: "NOT_REPRODUCED",
    reasonCode: "CHECKS_PASSED",
    summary: "The described scenario was performed and every expected-behavior check passed.",
  };
}
