import { COUPONS, MAX_QUANTITY, MIN_QUANTITY, type BugFlags, type Product } from "@reprolab/shared";

/**
 * The store's cart logic: the "system under test".
 *
 * Like many real carts it keeps denormalised totals (subtotal, discount,
 * total, itemCount) in state and updates them in each handler. That design is
 * exactly where the three demo bugs live: each bug flag skips one
 * recalculation. This file deliberately does NOT use the pricing functions in
 * store-spec.ts; the spec is the independent oracle.
 */

export interface CartLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface CartState {
  lines: CartLine[];
  couponCode: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  itemCount: number;
  message: { kind: "info" | "error"; text: string } | null;
}

export type CartAction =
  | { type: "add"; product: Product }
  | { type: "setQuantity"; productId: string; quantity: number }
  | { type: "remove"; productId: string }
  | { type: "applyCoupon"; code: string }
  | { type: "removeCoupon" }
  | { type: "clear" }
  | { type: "dismissMessage" };

export const EMPTY_CART: CartState = {
  lines: [],
  couponCode: null,
  subtotalCents: 0,
  discountCents: 0,
  totalCents: 0,
  itemCount: 0,
  message: null,
};

function discountFor(code: string | null, subtotalCents: number): number {
  const coupon = COUPONS.find((c) => c.code === code);
  if (!coupon) return 0;
  if (coupon.kind === "percent") return Math.round(subtotalCents * (coupon.percent / 100));
  return subtotalCents >= coupon.minSubtotalCents ? Math.min(coupon.amountCents, subtotalCents) : 0;
}

/** Recalculates every derived field from the lines and coupon. */
function recalculate(state: CartState): CartState {
  const subtotalCents = state.lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const discountCents = discountFor(state.couponCode, subtotalCents);
  return {
    ...state,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    itemCount: state.lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

export function cartReducer(state: CartState, action: CartAction, bugs: BugFlags): CartState {
  switch (action.type) {
    case "add": {
      const existing = state.lines.find((l) => l.productId === action.product.id);
      const lines = existing
        ? state.lines.map((l) =>
            l.productId === action.product.id ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + 1) } : l,
          )
        : [
            ...state.lines,
            {
              productId: action.product.id,
              name: action.product.name,
              unitPriceCents: action.product.priceCents,
              quantity: 1,
            },
          ];
      return recalculate({ ...state, lines, message: { kind: "info", text: `Added ${action.product.name} to your cart.` } });
    }

    case "setQuantity": {
      const quantity = Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, Math.trunc(action.quantity)));
      const lines = state.lines.map((l) => (l.productId === action.productId ? { ...l, quantity } : l));
      if (bugs.quantitySubtotal) {
        // BUG (quantitySubtotal): only the item count is refreshed; subtotal,
        // discount and total keep their old values.
        return { ...state, lines, itemCount: lines.reduce((sum, l) => sum + l.quantity, 0), message: null };
      }
      return recalculate({ ...state, lines, message: null });
    }

    case "remove": {
      const removed = state.lines.find((l) => l.productId === action.productId);
      const lines = state.lines.filter((l) => l.productId !== action.productId);
      const next = recalculate({
        ...state,
        lines,
        message: removed ? { kind: "info", text: `Removed ${removed.name}.` } : null,
      });
      if (bugs.staleCartBadge && lines.length === 0) {
        // BUG (staleCartBadge): the badge count is only refreshed while items remain.
        return { ...next, itemCount: state.itemCount };
      }
      return next;
    }

    case "applyCoupon": {
      const code = action.code.trim().toUpperCase();
      if (!code) return { ...state, message: { kind: "error", text: "Enter a coupon code." } };
      if (state.lines.length === 0) {
        return { ...state, message: { kind: "error", text: "Add an item before applying a coupon." } };
      }
      if (!COUPONS.some((c) => c.code === code)) {
        return { ...state, message: { kind: "error", text: `Coupon "${code}" is not valid.` } };
      }
      return recalculate({ ...state, couponCode: code, message: { kind: "info", text: `Coupon ${code} applied.` } });
    }

    case "removeCoupon": {
      const message = { kind: "info" as const, text: "Coupon removed." };
      if (bugs.couponRemovalTotal) {
        // BUG (couponRemovalTotal): the discount is cleared but the total is not
        // recalculated, so it keeps the discounted amount.
        return { ...state, couponCode: null, discountCents: 0, message };
      }
      return recalculate({ ...state, couponCode: null, message });
    }

    case "clear":
      return EMPTY_CART;

    case "dismissMessage":
      return { ...state, message: null };
  }
}

const STORAGE_KEY = "harbor-pine-cart-v1";

/** Cart state survives full page loads (each run starts with empty storage). */
export function loadCart(): CartState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CART;
    const parsed = JSON.parse(raw) as CartState;
    return Array.isArray(parsed.lines) ? { ...parsed, message: null } : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}

export function saveCart(state: CartState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, message: null }));
  } catch {
    // Storage can be unavailable (private mode); the cart then lives in memory only.
  }
}
