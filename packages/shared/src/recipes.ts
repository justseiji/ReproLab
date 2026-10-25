import type { ExpectedOutcome } from "./oracle";
import type { SeedKey } from "./seed-data";
import { TEST_IDS, type StoreRoute } from "./store-spec";

/**
 * Predefined reproduction recipes for scripted demo mode. A recipe is linked to
 * a seeded report by its seed key — never by fuzzy text matching — so a new
 * report is never silently given a recipe written for a different one.
 *
 * Steps name elements by test id; the scripted planner resolves each one
 * against the live observation, so a step can only act on an element that is
 * actually on the page, exactly like the live AI planner.
 */
export type RecipeStep =
  | { type: "navigate"; route: StoreRoute }
  | { type: "click"; testId: string }
  | { type: "fill"; testId: string; value: string }
  | { type: "select"; testId: string; option: string }
  | { type: "inspect" };

export interface ScriptedRecipe {
  seedKey: SeedKey;
  expected: ExpectedOutcome;
  steps: RecipeStep[];
}

export const RECIPES: Record<SeedKey, ScriptedRecipe> = {
  "coupon-removal-total": {
    seedKey: "coupon-removal-total",
    expected: {
      summary: "With the coupon removed there is no discount and total = subtotal.",
      triggers: ["coupon_applied", "coupon_removed"],
      checks: ["discount_matches_spec", "total_matches_spec"],
    },
    steps: [
      { type: "navigate", route: "/" },
      { type: "click", testId: TEST_IDS.addToCart("canvas-tote") },
      { type: "navigate", route: "/cart" },
      { type: "fill", testId: TEST_IDS.couponInput, value: "SAVE10" },
      { type: "click", testId: TEST_IDS.applyCoupon },
      { type: "click", testId: TEST_IDS.removeCoupon },
      { type: "inspect" },
    ],
  },
  "quantity-subtotal": {
    seedKey: "quantity-subtotal",
    expected: {
      summary: "After changing the quantity, subtotal and total reflect the new quantity.",
      triggers: ["quantity_changed"],
      checks: ["line_totals_match_spec", "subtotal_matches_spec", "total_matches_spec"],
    },
    steps: [
      { type: "navigate", route: "/" },
      { type: "click", testId: TEST_IDS.addToCart("ceramic-mug") },
      { type: "navigate", route: "/cart" },
      { type: "select", testId: TEST_IDS.quantitySelect("ceramic-mug"), option: "3" },
      { type: "inspect" },
    ],
  },
  "stale-cart-badge": {
    seedKey: "stale-cart-badge",
    expected: {
      summary: "Once the last item is removed the cart badge is hidden.",
      triggers: ["cart_emptied"],
      checks: ["badge_matches_cart"],
    },
    steps: [
      { type: "navigate", route: "/" },
      { type: "click", testId: TEST_IDS.addToCart("notebook-set") },
      { type: "navigate", route: "/cart" },
      { type: "click", testId: TEST_IDS.removeItem("notebook-set") },
      { type: "inspect" },
    ],
  },
};

export function findRecipe(seedKey: string | null | undefined): ScriptedRecipe | undefined {
  return seedKey && seedKey in RECIPES ? RECIPES[seedKey as SeedKey] : undefined;
}
