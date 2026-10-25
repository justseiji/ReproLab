import type { BrowserAction, ElementLocator } from "./actions";
import type { CartObservation } from "./observation";
import {
  CHECK_DESCRIPTIONS,
  expectedCartFromObservation,
  type CheckResult,
  type ExpectedOutcome,
  type OracleCheck,
} from "./oracle";
import { formatMoney, TEST_IDS, type ExpectedCart } from "./store-spec";

/**
 * Generates a Playwright regression test from a validated action trace.
 *
 * Every line of output comes from the fixed templates below. Dynamic values
 * (test ids, fill values, the report title) are embedded with JSON.stringify,
 * so they can only ever appear as string literals. Model output never becomes
 * code. Assertions state the *specification's* values, computed from the cart
 * inputs, never the faulty values observed during the run.
 */

export interface TestStep {
  action: BrowserAction;
  locator: ElementLocator | null;
}

export interface RegressionTestInput {
  runId: string;
  reportTitle: string;
  modeLabel: string;
  generatedAt: string;
  /** Successfully executed steps, in order. */
  steps: TestStep[];
  expected: ExpectedOutcome;
  finalCart: CartObservation;
  checkResults: CheckResult[];
}

export type RegressionTestResult = { ok: true; fileName: string; code: string } | { ok: false; reason: string };

const literal = (value: string) => JSON.stringify(value);
const comment = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, " ").slice(0, 200);
const byTestId = (testId: string) => `page.getByTestId(${literal(testId)})`;

function locatorCode(locator: ElementLocator): string {
  return locator.kind === "testId"
    ? byTestId(locator.testId)
    : `page.getByRole(${literal(locator.role)}, { name: ${literal(locator.name)}, exact: true })`;
}

function stepCode(step: TestStep): string[] | { error: string } {
  const { action, locator } = step;
  switch (action.type) {
    case "navigate":
      return [
        `await page.goto(new URL(${literal(action.route)}, STORE_URL).href);`,
        `await expect(${byTestId(TEST_IDS.header)}).toBeVisible();`,
      ];
    case "inspect":
      return [];
    case "click":
    case "fill":
    case "select": {
      if (!locator) return { error: `Step "${action.type}" has no stable locator.` };
      const target = locatorCode(locator);
      if (action.type === "click") return [`await ${target}.click();`];
      if (action.type === "fill") return [`await ${target}.fill(${literal(action.value)});`];
      return [`await ${target}.selectOption({ label: ${literal(action.option)} });`];
    }
  }
}

function hiddenOrText(testId: string, cents: number, hiddenWhenZero: boolean): string {
  return hiddenWhenZero && cents === 0
    ? `await expect(${byTestId(testId)}).toBeHidden();`
    : `await expect(${byTestId(testId)}).toHaveText(${literal(formatMoney(cents))});`;
}

function assertionCode(check: OracleCheck, cart: ExpectedCart): string[] {
  const empty = cart.lines.length === 0;
  switch (check) {
    case "line_totals_match_spec":
      return cart.lines.map(
        (l) => `await expect(${byTestId(TEST_IDS.lineTotal(l.productId))}).toHaveText(${literal(formatMoney(l.lineTotalCents))});`,
      );
    case "subtotal_matches_spec":
      return [hiddenOrText(TEST_IDS.subtotal, cart.subtotalCents, empty)];
    case "total_matches_spec":
      return [hiddenOrText(TEST_IDS.total, cart.totalCents, empty)];
    case "discount_matches_spec":
      return [hiddenOrText(TEST_IDS.discount, -cart.discountCents, true)];
    case "badge_matches_cart":
      return [
        cart.itemCount === 0
          ? `await expect(${byTestId(TEST_IDS.badge)}).toBeHidden();`
          : `await expect(${byTestId(TEST_IDS.badge)}).toHaveText(${literal(String(cart.itemCount))});`,
      ];
  }
}

export function testFileName(reportTitle: string, runId: string): string {
  const slug = reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "report";
  return `reprolab-${slug}-${runId.slice(0, 8)}.spec.ts`;
}

export function generateRegressionTest(input: RegressionTestInput): RegressionTestResult {
  if (input.steps.length === 0 || input.steps[0]?.action.type !== "navigate") {
    return { ok: false, reason: "The trace must start with a navigation step." };
  }
  const failed = input.checkResults.filter((r) => r.status === "fail");
  if (failed.length === 0) {
    return { ok: false, reason: "No specification check failed, so there is no evidence-backed assertion to make." };
  }
  const cart = expectedCartFromObservation(input.finalCart);
  if ("error" in cart) return { ok: false, reason: cart.error };

  const body: string[] = [];
  for (const step of input.steps) {
    const lines = stepCode(step);
    if ("error" in lines) return { ok: false, reason: lines.error };
    body.push(...lines);
  }

  const assertions: string[] = [];
  for (const check of input.expected.checks) {
    assertions.push(`// Spec: ${CHECK_DESCRIPTIONS[check]}`);
    assertions.push(...assertionCode(check, cart));
  }

  const observed = failed.map(
    (r) => `//   ${r.check}: expected ${comment(r.expected)}, observed ${comment(r.observed)}`,
  );

  const code = [
    `// Regression test generated by ReproLab.`,
    `// Report: ${comment(input.reportTitle)}`,
    `// Run: ${input.runId} (${comment(input.modeLabel)}), generated ${input.generatedAt}`,
    `// Expected outcome: ${comment(input.expected.summary)}`,
    `// Observed while the bug was present:`,
    ...observed,
    `// The assertions below encode the store specification, so this test fails`,
    `// while the bug exists and passes once it is fixed.`,
    `import { test, expect } from "@playwright/test";`,
    ``,
    `const STORE_URL = process.env.STORE_URL ?? "http://localhost:4100";`,
    ``,
    // Named after the intended behavior, not the bug.
    `test(${literal(input.expected.summary)}, async ({ page }) => {`,
    ...body.map((line) => `  ${line}`),
    ``,
    ...assertions.map((line) => `  ${line}`),
    `});`,
    ``,
  ].join("\n");

  return { ok: true, fileName: testFileName(input.reportTitle, input.runId), code };
}
