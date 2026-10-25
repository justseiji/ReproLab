import { describe, expect, it } from "vitest";
import { decideOutcome, detectTriggers, evaluateChecks, type CartObservation, type ExpectedOutcome } from "../src";

const cart = (over: Partial<CartObservation>): CartObservation => ({
  onCartPage: true,
  badgeVisible: true,
  badgeCount: 1,
  lines: [{ productId: "canvas-tote", name: "Canvas Tote", quantity: 1, unitPriceCents: null, lineTotalCents: 2400 }],
  couponCode: null,
  subtotalCents: 2400,
  discountCents: null,
  totalCents: 2400,
  emptyStateVisible: false,
  ...over,
});

describe("trigger detection", () => {
  it("detects coupon application and removal on the cart page", () => {
    const applied = cart({ couponCode: "SAVE10", discountCents: -240, totalCents: 2160 });
    expect(detectTriggers(cart({}), applied)).toEqual(["coupon_applied"]);
    expect(detectTriggers(applied, cart({ totalCents: 2160 }))).toEqual(["coupon_removed"]);
  });

  it("detects quantity changes, removals and the cart becoming empty", () => {
    const three = cart({ lines: [{ productId: "canvas-tote", name: "", quantity: 3, unitPriceCents: null, lineTotalCents: 7200 }] });
    expect(detectTriggers(cart({}), three)).toEqual(["quantity_changed"]);
    expect(detectTriggers(cart({}), cart({ lines: [], emptyStateVisible: true }))).toEqual(["item_removed", "cart_emptied"]);
  });

  it("uses the header badge to detect additions away from the cart page", () => {
    const offCart = (count: number) => cart({ onCartPage: false, lines: null, badgeCount: count, badgeVisible: count > 0 });
    expect(detectTriggers(offCart(0), offCart(1))).toEqual(["item_added"]);
    expect(detectTriggers(offCart(1), offCart(1))).toEqual([]);
  });
});

describe("specification checks", () => {
  it("passes a correct cart", () => {
    const results = evaluateChecks(cart({}), ["line_totals_match_spec", "subtotal_matches_spec", "total_matches_spec", "badge_matches_cart"]);
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  it("uses the inputs (quantities, coupon), not the displayed totals, as the source of truth", () => {
    // Quantity 3 but subtotal still shows the old $24.00.
    const stale = cart({
      lines: [{ productId: "canvas-tote", name: "", quantity: 3, unitPriceCents: null, lineTotalCents: 7200 }],
      badgeCount: 3,
    });
    const [subtotal, total] = evaluateChecks(stale, ["subtotal_matches_spec", "total_matches_spec"]);
    expect(subtotal).toMatchObject({ status: "fail", expected: "$72.00", observed: "$24.00" });
    expect(total).toMatchObject({ status: "fail", expected: "$72.00" });
  });

  it("flags a discounted total that remains after the coupon is gone", () => {
    const [discount, total] = evaluateChecks(cart({ totalCents: 2160 }), ["discount_matches_spec", "total_matches_spec"]);
    expect(discount!.status).toBe("pass");
    expect(total).toMatchObject({ status: "fail", expected: "$24.00", observed: "$21.60" });
  });

  it("expects a hidden badge for an empty cart", () => {
    const empty = cart({ lines: [], subtotalCents: null, totalCents: null, emptyStateVisible: true });
    expect(evaluateChecks(empty, ["badge_matches_cart"])[0]).toMatchObject({ status: "fail", expected: "hidden (0 items)", observed: "1" });
    expect(evaluateChecks({ ...empty, badgeVisible: false, badgeCount: 0 }, ["badge_matches_cart"])[0]!.status).toBe("pass");
  });

  it("cannot evaluate totals away from the cart page", () => {
    const results = evaluateChecks(cart({ onCartPage: false, lines: null }), ["total_matches_spec"]);
    expect(results[0]!.status).toBe("not_evaluable");
  });
});

describe("outcome decision", () => {
  const expected: ExpectedOutcome = {
    summary: "Removing the coupon restores the total",
    triggers: ["coupon_applied", "coupon_removed"],
    checks: ["total_matches_spec"],
  };
  const both = new Set(["coupon_applied", "coupon_removed"] as const);

  it("reports Reproduced only when the scenario happened and a check failed", () => {
    const d = decideOutcome({ expected, stopReason: "completed", observedTriggers: both, finalCart: cart({ totalCents: 2160 }) });
    expect(d).toMatchObject({ outcome: "REPRODUCED", reasonCode: "CHECK_FAILED" });
  });

  it("reports Not reproduced when the scenario happened and checks pass", () => {
    const d = decideOutcome({ expected, stopReason: "completed", observedTriggers: both, finalCart: cart({}) });
    expect(d).toMatchObject({ outcome: "NOT_REPRODUCED", reasonCode: "CHECKS_PASSED" });
  });

  it("never reports Not reproduced if the trigger was never observed", () => {
    const d = decideOutcome({ expected, stopReason: "completed", observedTriggers: new Set(["coupon_applied"]), finalCart: cart({}) });
    expect(d).toMatchObject({ outcome: "INCONCLUSIVE", reasonCode: "TRIGGER_NOT_OBSERVED", missingTriggers: ["coupon_removed"] });
  });

  it("is inconclusive when steps failed, the budget ran out, or the totals are not visible", () => {
    const failing = cart({ totalCents: 2160 });
    expect(decideOutcome({ expected, stopReason: "step_failed", observedTriggers: both, finalCart: failing }).outcome).toBe("INCONCLUSIVE");
    expect(decideOutcome({ expected, stopReason: "budget_exhausted", observedTriggers: both, finalCart: failing }).reasonCode).toBe(
      "BUDGET_EXHAUSTED",
    );
    const offPage = cart({ onCartPage: false, lines: null });
    expect(decideOutcome({ expected, stopReason: "completed", observedTriggers: both, finalCart: offPage }).reasonCode).toBe(
      "CHECK_NOT_EVALUABLE",
    );
  });
});
