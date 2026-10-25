import { describe, expect, it } from "vitest";
import { computeExpectedCart, couponDiscountCents, findCoupon, formatMoney, parseMoney } from "../src";

describe("store specification arithmetic", () => {
  it("computes line totals, subtotal, item count and total", () => {
    const cart = computeExpectedCart(
      [
        { productId: "canvas-tote", quantity: 2 },
        { productId: "ceramic-mug", quantity: 3 },
      ],
      null,
    );
    expect(cart.lines.map((l) => l.lineTotalCents)).toEqual([4800, 5400]);
    expect(cart).toMatchObject({ subtotalCents: 10200, discountCents: 0, totalCents: 10200, itemCount: 5 });
  });

  it("applies SAVE10 as 10% rounded to the nearest cent", () => {
    expect(computeExpectedCart([{ productId: "canvas-tote", quantity: 1 }], "SAVE10")).toMatchObject({
      subtotalCents: 2400,
      discountCents: 240,
      totalCents: 2160,
    });
    // 3 × $15.00 = $45.00 → $4.50 off; 1 × $15 → $1.50 off
    expect(couponDiscountCents(findCoupon("save10"), 4500)).toBe(450);
    expect(couponDiscountCents(findCoupon("SAVE10"), 1505)).toBe(151);
  });

  it("applies WELCOME5 only at or above the $25 minimum", () => {
    expect(couponDiscountCents(findCoupon("WELCOME5"), 2499)).toBe(0);
    expect(couponDiscountCents(findCoupon("WELCOME5"), 2500)).toBe(500);
    expect(computeExpectedCart([{ productId: "notebook-set", quantity: 1 }], "WELCOME5").totalCents).toBe(1500);
  });

  it("treats unknown coupons as no discount and an empty cart as zero", () => {
    expect(computeExpectedCart([{ productId: "desk-lamp", quantity: 1 }], "FREE100").discountCents).toBe(0);
    expect(computeExpectedCart([], "SAVE10")).toMatchObject({ subtotalCents: 0, totalCents: 0, itemCount: 0 });
  });

  it("rejects unknown products instead of guessing a price", () => {
    expect(() => computeExpectedCart([{ productId: "mystery", quantity: 1 }], null)).toThrow(/Unknown product/);
  });

  it("formats and parses money consistently", () => {
    expect(formatMoney(2160)).toBe("$21.60");
    expect(formatMoney(-240)).toBe("-$2.40");
    expect(formatMoney(123456)).toBe("$1,234.56");
    for (const cents of [0, 5, 2160, -240, 123456]) expect(parseMoney(formatMoney(cents))).toBe(cents);
    expect(parseMoney("−$2.40")).toBe(-240);
    expect(parseMoney("free")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
});
