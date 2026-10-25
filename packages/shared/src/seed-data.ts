import type { ReportInput } from "./report";
import type { BugKey } from "./store-spec";

export const SEED_KEYS = ["coupon-removal-total", "quantity-subtotal", "stale-cart-badge"] as const;
export type SeedKey = (typeof SEED_KEYS)[number];

export interface SeededReport extends ReportInput {
  seedKey: SeedKey;
  /** The store bug this report describes. Used only by tests and the evaluation command. */
  bug: BugKey;
}

export const SEEDED_REPORTS: readonly SeededReport[] = [
  {
    seedKey: "coupon-removal-total",
    bug: "couponRemovalTotal",
    title: "Removing a coupon leaves the discounted total",
    description: [
      "1. Add the Canvas Tote to the cart.",
      "2. Open the cart.",
      "3. Apply the coupon code SAVE10.",
      "4. Remove the coupon again.",
    ].join("\n"),
    expectedBehavior:
      "After the coupon is removed there is no discount and the total goes back to the full subtotal ($24.00).",
    actualBehavior: "The discount line disappears, but the total still shows the discounted amount ($21.60).",
  },
  {
    seedKey: "quantity-subtotal",
    bug: "quantitySubtotal",
    title: "Changing quantity does not update the subtotal",
    description: [
      "1. Add the Ceramic Mug to the cart.",
      "2. Open the cart.",
      "3. Change the mug's quantity from 1 to 3.",
    ].join("\n"),
    expectedBehavior: "The subtotal and total update to 3 × $18.00 = $54.00.",
    actualBehavior: "The line total shows $54.00 but the subtotal and total stay at $18.00.",
  },
  {
    seedKey: "stale-cart-badge",
    bug: "staleCartBadge",
    title: "Cart badge still shows 1 after removing the last item",
    description: [
      "1. Add the Dot-Grid Notebook Set to the cart.",
      "2. Open the cart.",
      "3. Remove the notebook set so the cart is empty.",
    ].join("\n"),
    expectedBehavior: "The cart is empty and the cart badge in the header disappears.",
    actualBehavior: "The cart page says it is empty, but the header badge still shows 1.",
  },
];

export function findSeededReport(seedKey: string | null | undefined): SeededReport | undefined {
  return SEEDED_REPORTS.find((r) => r.seedKey === seedKey);
}
