import { describe, expect, it } from "vitest";
import {
  BrowserActionSchema,
  checkActionAgainstObservation,
  CreateReportRequestSchema,
  ReportInputSchema,
  type ObservedElement,
  type PageObservation,
} from "../src";
import { EMPTY_CART_OBSERVATION } from "../src/observation";

const validReport = {
  title: "Coupon removal keeps discount",
  description: "1. Add an item\n2. Apply SAVE10\n3. Remove it",
  expectedBehavior: "Total returns to the subtotal",
};

describe("report validation", () => {
  it("accepts a valid report and trims whitespace", () => {
    const parsed = ReportInputSchema.parse({ ...validReport, title: "  Coupon removal keeps discount  " });
    expect(parsed.title).toBe("Coupon removal keeps discount");
    expect(parsed.actualBehavior).toBeUndefined();
  });

  it("reports every invalid field with a readable message", () => {
    const result = ReportInputSchema.safeParse({ title: "Bug", description: "short", expectedBehavior: "" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(messages).toEqual([
      "title: Title must be at least 5 characters.",
      "description: Steps or description must be at least 10 characters.",
      "expectedBehavior: Expected behavior must be at least 5 characters.",
    ]);
  });

  it("rejects missing fields, unknown keys and over-long text", () => {
    expect(ReportInputSchema.safeParse({ title: "Valid title" }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ ...validReport, priority: "high" }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ ...validReport, title: "x".repeat(121) }).success).toBe(false);
  });

  it("strips control characters and treats a blank actual behavior as absent", () => {
    const parsed = ReportInputSchema.parse({ ...validReport, title: "Bad\u0007 title\u0000", actualBehavior: "   " });
    expect(parsed.title).toBe("Bad title");
    expect(parsed.actualBehavior).toBeUndefined();
  });

  it("only accepts the two run modes", () => {
    expect(CreateReportRequestSchema.safeParse({ report: validReport, mode: "SCRIPTED" }).success).toBe(true);
    expect(CreateReportRequestSchema.safeParse({ report: validReport, mode: "LIVE_AI" }).success).toBe(true);
    expect(CreateReportRequestSchema.safeParse({ report: validReport, mode: "AUTO" }).success).toBe(false);
  });
});

describe("browser action vocabulary", () => {
  it("accepts each allowed action", () => {
    for (const action of [
      { type: "navigate", route: "/cart" },
      { type: "click", elementId: "e3" },
      { type: "fill", elementId: "e4", value: "SAVE10" },
      { type: "select", elementId: "e5", option: "3" },
      { type: "inspect" },
    ]) {
      expect(BrowserActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(true);
    }
  });

  it("rejects anything that could run code or leave the store", () => {
    const rejected = [
      { type: "evaluate", script: "document.cookie" },
      { type: "navigate", route: "https://evil.test/" },
      { type: "navigate", route: "/admin/bugs" },
      { type: "click", elementId: "e1", script: "alert(1)" },
      { type: "click", selector: "#buy" },
      { type: "click", elementId: "button.primary" },
      { type: "fill", elementId: "e1", value: "x".repeat(201) },
    ];
    for (const action of rejected) {
      expect(BrowserActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(false);
    }
  });
});

const element = (over: Partial<ObservedElement>): ObservedElement => ({
  id: "e1",
  role: "button",
  name: "Apply",
  tag: "button",
  testId: "apply-coupon",
  inputType: null,
  value: null,
  options: null,
  disabled: false,
  ...over,
});

const observation = (elements: ObservedElement[]): PageObservation => ({
  url: "http://localhost:4100/cart",
  path: "/cart",
  title: "",
  headings: [],
  messages: [],
  elements,
  textExcerpt: "",
  cart: EMPTY_CART_OBSERVATION,
});

describe("validating actions against the current observation", () => {
  const page = observation([
    element({}),
    element({ id: "e2", role: "textbox", name: "Coupon code", tag: "input", inputType: "text", testId: "coupon-input", value: "" }),
    element({ id: "e3", role: "combobox", name: "Quantity", tag: "select", testId: "qty-select-ceramic-mug", options: ["1", "2", "3"] }),
    element({ id: "e4", name: "Checkout", testId: "go-to-checkout", disabled: true }),
    element({ id: "e5", name: "", testId: null }),
  ]);

  it("returns a stable locator for a valid action", () => {
    const check = checkActionAgainstObservation({ type: "click", elementId: "e1" }, page);
    expect(check).toMatchObject({ ok: true, locator: { kind: "testId", testId: "apply-coupon" } });
  });

  it("rejects elements that were not observed, are disabled, or cannot be located", () => {
    expect(checkActionAgainstObservation({ type: "click", elementId: "e99" }, page)).toMatchObject({ ok: false });
    expect(checkActionAgainstObservation({ type: "click", elementId: "e4" }, page)).toMatchObject({ ok: false });
    expect(checkActionAgainstObservation({ type: "click", elementId: "e5" }, page)).toMatchObject({ ok: false });
  });

  it("only fills text inputs and only selects listed options", () => {
    expect(checkActionAgainstObservation({ type: "fill", elementId: "e1", value: "x" }, page)).toMatchObject({ ok: false });
    expect(checkActionAgainstObservation({ type: "fill", elementId: "e2", value: "SAVE10" }, page)).toMatchObject({ ok: true });
    expect(checkActionAgainstObservation({ type: "select", elementId: "e3", option: "11" }, page)).toMatchObject({ ok: false });
    expect(checkActionAgainstObservation({ type: "select", elementId: "e3", option: "3" }, page)).toMatchObject({ ok: true });
  });
});
