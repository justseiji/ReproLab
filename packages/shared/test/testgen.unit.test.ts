import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { evaluateChecks, generateRegressionTest, type CartObservation, type RegressionTestInput } from "../src";

const finalCart: CartObservation = {
  onCartPage: true,
  badgeVisible: true,
  badgeCount: 1,
  lines: [{ productId: "canvas-tote", name: "Canvas Tote", quantity: 1, unitPriceCents: null, lineTotalCents: 2400 }],
  couponCode: null,
  subtotalCents: 2400,
  discountCents: null,
  totalCents: 2160, // the bug: discounted total after coupon removal
  emptyStateVisible: false,
};

const input = (over: Partial<RegressionTestInput> = {}): RegressionTestInput => {
  const expected = over.expected ?? {
    summary: "Total equals subtotal after coupon removal",
    triggers: ["coupon_applied", "coupon_removed"],
    checks: ["discount_matches_spec", "total_matches_spec"],
  };
  return {
    runId: "11111111-2222-3333-4444-555555555555",
    reportTitle: "Coupon removal bug",
    modeLabel: "Scripted demo",
    generatedAt: "2026-10-25T00:00:00.000Z",
    steps: [
      { action: { type: "navigate", route: "/" }, locator: null },
      { action: { type: "click", elementId: "e3" }, locator: { kind: "testId", testId: "add-to-cart-canvas-tote" } },
      { action: { type: "navigate", route: "/cart" }, locator: null },
      { action: { type: "fill", elementId: "e7", value: "SAVE10" }, locator: { kind: "testId", testId: "coupon-input" } },
    ],
    expected,
    finalCart,
    checkResults: evaluateChecks(finalCart, expected.checks),
    ...over,
  };
};

/** Parses the output as TypeScript; throws on any syntax error. */
const assertParses = (code: string) => transformSync(code, { loader: "ts", format: "esm" });

describe("regression test generation", () => {
  it("asserts the specification's value, not the faulty observed value", () => {
    const result = generateRegressionTest(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain(`await expect(page.getByTestId("cart-total")).toHaveText("$24.00");`);
    expect(result.code).toContain(`await expect(page.getByTestId("cart-discount")).toBeHidden();`);
    expect(result.code).not.toMatch(/toHaveText\("\$21\.60"\)/);
    expect(result.code).toContain(`await page.getByTestId("coupon-input").fill("SAVE10");`);
    expect(result.fileName).toBe("reprolab-coupon-removal-bug-11111111.spec.ts");
    assertParses(result.code);
  });

  it("keeps hostile strings inside string literals", () => {
    const hostile = `"); require("child_process").exec("rm -rf /"); ("`;
    const result = generateRegressionTest(
      input({
        reportTitle: `*/ ${hostile}\nprocess.exit(1) //`,
        steps: [
          { action: { type: "navigate", route: "/" }, locator: null },
          { action: { type: "fill", elementId: "e7", value: hostile }, locator: { kind: "testId", testId: "coupon-input" } },
          { action: { type: "click", elementId: "e8" }, locator: { kind: "role", role: "button", name: `Apply ${hostile}` } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertParses(result.code);
    expect(result.code).toContain(`.fill(${JSON.stringify(hostile)})`);
    // The only statements are the template's: no injected call to require/exec at statement level.
    expect(result.code).not.toMatch(/^\s*require\(/m);
    expect(result.code.split("\n").filter((l) => l.includes("process.exit")).every((l) => l.trimStart().startsWith("//"))).toBe(true);
  });

  it("refuses to generate a test without evidence of a failing check", () => {
    const passingCart = { ...finalCart, totalCents: 2400 };
    const expected = input().expected;
    const result = generateRegressionTest(input({ finalCart: passingCart, checkResults: evaluateChecks(passingCart, expected.checks) }));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses traces that do not start with navigation or lack stable locators", () => {
    expect(generateRegressionTest(input({ steps: [] })).ok).toBe(false);
    const noLocator = input({
      steps: [
        { action: { type: "navigate", route: "/" }, locator: null },
        { action: { type: "click", elementId: "e3" }, locator: null },
      ],
    });
    expect(generateRegressionTest(noLocator).ok).toBe(false);
  });
});
