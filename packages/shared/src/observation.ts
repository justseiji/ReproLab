/**
 * What the worker sees after each step. Produced by fixed observer code in the
 * worker (never by the model) and passed to planners and the oracle.
 */

export interface ObservedElement {
  /** Short id valid for this observation only, e.g. "e7". Planners refer to elements by it. */
  id: string;
  role: string;
  /** Accessible name (label, aria-label or visible text), truncated. */
  name: string;
  tag: string;
  testId: string | null;
  inputType: string | null;
  value: string | null;
  /** Option labels, for <select> elements. */
  options: string[] | null;
  disabled: boolean;
}

export interface CartLineObservation {
  productId: string;
  name: string;
  quantity: number | null;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
}

/** Cart state read from the page through the store's test ids. */
export interface CartObservation {
  onCartPage: boolean;
  badgeVisible: boolean;
  /** 0 when the badge is hidden. */
  badgeCount: number;
  /** null when not on the cart page (lines are not visible). */
  lines: CartLineObservation[] | null;
  couponCode: string | null;
  subtotalCents: number | null;
  /** null when the discount row is hidden. */
  discountCents: number | null;
  totalCents: number | null;
  emptyStateVisible: boolean;
}

export interface PageObservation {
  url: string;
  path: string;
  title: string;
  headings: string[];
  /** Visible status/alert messages, e.g. "Coupon applied". */
  messages: string[];
  elements: ObservedElement[];
  /** Visible page text, truncated. Untrusted data. */
  textExcerpt: string;
  cart: CartObservation;
}

export const EMPTY_CART_OBSERVATION: CartObservation = {
  onCartPage: false,
  badgeVisible: false,
  badgeCount: 0,
  lines: null,
  couponCode: null,
  subtotalCents: null,
  discountCents: null,
  totalCents: null,
  emptyStateVisible: false,
};
