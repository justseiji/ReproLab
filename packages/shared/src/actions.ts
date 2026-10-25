import { z } from "zod";
import type { ObservedElement, PageObservation } from "./observation";
import { STORE_ROUTES } from "./store-spec";

/**
 * The complete browser action vocabulary. Planners (scripted recipes and the
 * live AI model) can only express these actions; there is no way to run
 * arbitrary JavaScript, open arbitrary URLs, or touch anything outside the store.
 */

export const MAX_FILL_LENGTH = 200;

const ElementIdSchema = z.string().regex(/^e\d{1,4}$/, "elementId must look like e12");

export const NavigateActionSchema = z.strictObject({
  type: z.literal("navigate"),
  route: z.enum(STORE_ROUTES),
});
export const ClickActionSchema = z.strictObject({
  type: z.literal("click"),
  elementId: ElementIdSchema,
});
export const FillActionSchema = z.strictObject({
  type: z.literal("fill"),
  elementId: ElementIdSchema,
  value: z.string().max(MAX_FILL_LENGTH),
});
export const SelectActionSchema = z.strictObject({
  type: z.literal("select"),
  elementId: ElementIdSchema,
  option: z.string().min(1).max(100),
});
export const InspectActionSchema = z.strictObject({
  type: z.literal("inspect"),
});

export const BrowserActionSchema = z.discriminatedUnion("type", [
  NavigateActionSchema,
  ClickActionSchema,
  FillActionSchema,
  SelectActionSchema,
  InspectActionSchema,
]);
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type BrowserActionType = BrowserAction["type"];

/** How an element is found again, in the executor and in generated tests. */
export type ElementLocator = { kind: "testId"; testId: string } | { kind: "role"; role: string; name: string };

export function locatorForElement(element: ObservedElement): ElementLocator | null {
  if (element.testId) return { kind: "testId", testId: element.testId };
  if (element.name) return { kind: "role", role: element.role, name: element.name };
  return null;
}

export function describeLocator(locator: ElementLocator): string {
  return locator.kind === "testId" ? `[data-testid="${locator.testId}"]` : `${locator.role} "${locator.name}"`;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "tel", "url", "number", "password"]);

export type ActionCheck =
  | { ok: true; element: ObservedElement | null; locator: ElementLocator | null }
  | { ok: false; reason: string };

/**
 * Checks an already schema-valid action against the current observation:
 * the element must have been observed on this page, be enabled, and suit the
 * action. This is the second validation gate for model output.
 */
export function checkActionAgainstObservation(action: BrowserAction, observation: PageObservation): ActionCheck {
  if (action.type === "navigate" || action.type === "inspect") return { ok: true, element: null, locator: null };

  const element = observation.elements.find((e) => e.id === action.elementId);
  if (!element) return { ok: false, reason: `Element ${action.elementId} was not in the current observation.` };
  if (element.disabled) return { ok: false, reason: `Element ${action.elementId} is disabled.` };
  const locator = locatorForElement(element);
  if (!locator) return { ok: false, reason: `Element ${action.elementId} has no stable locator (no test id or name).` };

  if (action.type === "fill") {
    const fillable =
      element.tag === "textarea" || (element.tag === "input" && TEXT_INPUT_TYPES.has(element.inputType ?? "text"));
    if (!fillable) return { ok: false, reason: `Element ${action.elementId} is not a text input.` };
  }
  if (action.type === "select") {
    if (element.tag !== "select" || !element.options) {
      return { ok: false, reason: `Element ${action.elementId} is not a select element.` };
    }
    if (!element.options.includes(action.option)) {
      return { ok: false, reason: `"${action.option}" is not one of the options of ${action.elementId}.` };
    }
  }
  return { ok: true, element, locator };
}

export function describeAction(action: BrowserAction, element: ObservedElement | null): string {
  const label = element ? `“${element.name || element.testId || element.id}”` : "";
  switch (action.type) {
    case "navigate":
      return `Navigate to ${action.route}`;
    case "click":
      return `Click ${label}`;
    case "fill":
      return `Fill ${label} with “${action.value}”`;
    case "select":
      return `Select “${action.option}” in ${label}`;
    case "inspect":
      return "Inspect visible page state";
  }
}
