/**
 * Demo store specification.
 *
 * This file is the single source of truth for the catalog, the coupons, and the
 * pricing rules the store is *supposed* to follow. The store has its own,
 * independent implementation (which contains the three deliberate bugs). The
 * reproduction engine uses the pure functions below as an oracle: it reads the
 * cart's inputs from the page (products, quantities, coupon) and checks that the
 * displayed outputs (line totals, subtotal, discount, total, badge) match.
 */

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  category: string;
  description: string;
  /** CSS colour used for the product tile illustration. */
  accent: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "canvas-tote",
    name: "Canvas Tote",
    priceCents: 2400,
    category: "Bags",
    description: "Heavyweight cotton canvas with an inside pocket.",
    accent: "#c8a97e",
  },
  {
    id: "ceramic-mug",
    name: "Ceramic Mug",
    priceCents: 1800,
    category: "Kitchen",
    description: "Stoneware mug with a speckled glaze. Holds 350 ml.",
    accent: "#7e9cc8",
  },
  {
    id: "notebook-set",
    name: "Dot-Grid Notebook Set",
    priceCents: 1500,
    category: "Stationery",
    description: "Three A5 notebooks with lay-flat binding.",
    accent: "#9cc87e",
  },
  {
    id: "pour-over",
    name: "Pour-Over Coffee Kit",
    priceCents: 4200,
    category: "Kitchen",
    description: "Glass dripper, carafe and 100 paper filters.",
    accent: "#b07a5a",
  },
  {
    id: "desk-lamp",
    name: "Brass Desk Lamp",
    priceCents: 6400,
    category: "Home",
    description: "Adjustable arm and a warm, dimmable LED.",
    accent: "#d4b45a",
  },
  {
    id: "wool-throw",
    name: "Merino Wool Throw",
    priceCents: 8900,
    category: "Home",
    description: "Soft knit throw, 130 × 170 cm.",
    accent: "#a88bc0",
  },
];

export type Coupon =
  | { code: string; kind: "percent"; percent: number; description: string }
  | { code: string; kind: "fixed"; amountCents: number; minSubtotalCents: number; description: string };

export const COUPONS: readonly Coupon[] = [
  { code: "SAVE10", kind: "percent", percent: 10, description: "10% off the subtotal" },
  {
    code: "WELCOME5",
    kind: "fixed",
    amountCents: 500,
    minSubtotalCents: 2500,
    description: "$5 off orders of $25 or more",
  },
];

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 10;

/** Human-readable rules. Shown in the UI and given to the live AI planner. */
export const STORE_RULES: readonly string[] = [
  "Line total = unit price × quantity. Quantities range from 1 to 10.",
  "Subtotal = sum of all line totals.",
  "SAVE10 takes 10% off the subtotal (rounded to the nearest cent).",
  "WELCOME5 takes $5 off when the subtotal is at least $25; otherwise it gives no discount.",
  "Total = subtotal − discount. With no coupon applied, the discount is $0 and the discount row is hidden.",
  "The header cart badge shows the total quantity of items and is hidden when the cart is empty.",
  "An empty cart shows an empty-state message and no subtotal or total.",
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function findCoupon(code: string | null | undefined): Coupon | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toUpperCase();
  return COUPONS.find((c) => c.code === normalized);
}

export function couponDiscountCents(coupon: Coupon | undefined, subtotalCents: number): number {
  if (!coupon) return 0;
  if (coupon.kind === "percent") return Math.round((subtotalCents * coupon.percent) / 100);
  return subtotalCents >= coupon.minSubtotalCents ? Math.min(coupon.amountCents, subtotalCents) : 0;
}

export interface CartLineInput {
  productId: string;
  quantity: number;
}

export interface ExpectedCart {
  lines: Array<{ productId: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  itemCount: number;
}

/** The reference model: what the cart must display for the given inputs. */
export function computeExpectedCart(lines: readonly CartLineInput[], couponCode: string | null): ExpectedCart {
  const expectedLines = lines.map((line) => {
    const product = findProduct(line.productId);
    if (!product) throw new Error(`Unknown product "${line.productId}"`);
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * line.quantity,
    };
  });
  const subtotalCents = expectedLines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const discountCents = couponDiscountCents(findCoupon(couponCode), subtotalCents);
  return {
    lines: expectedLines,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    itemCount: expectedLines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

/** Parses "$1,234.50", "-$2.40" or "−$2.40" into cents. Returns null if unparseable. */
export function parseMoney(text: string | null | undefined): number | null {
  if (text == null) return null;
  const normalized = text.replace(/\u2212/g, "-").replace(/[^0-9.-]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number.parseFloat(normalized) * 100);
}

/** Routes the browser agent may navigate to. Anything else is rejected. */
export const STORE_ROUTES = ["/", "/cart", "/checkout"] as const;
export type StoreRoute = (typeof STORE_ROUTES)[number];

/** Stable test ids. The store renders them; the observer and generated tests read them. */
export const TEST_IDS = {
  header: "store-header",
  badge: "cart-badge",
  subtotal: "cart-subtotal",
  discount: "cart-discount",
  total: "cart-total",
  couponInput: "coupon-input",
  applyCoupon: "apply-coupon",
  removeCoupon: "remove-coupon",
  appliedCoupon: "applied-coupon",
  cartEmpty: "cart-empty",
  cartLine: (productId: string) => `cart-line-${productId}`,
  quantitySelect: (productId: string) => `qty-select-${productId}`,
  removeItem: (productId: string) => `remove-item-${productId}`,
  lineTotal: (productId: string) => `line-total-${productId}`,
  addToCart: (productId: string) => `add-to-cart-${productId}`,
} as const;

/** The three deliberate bugs. Each can be switched between broken and fixed. */
export const BUG_KEYS = ["couponRemovalTotal", "quantitySubtotal", "staleCartBadge"] as const;
export type BugKey = (typeof BUG_KEYS)[number];
/** true = the bug is enabled (broken behaviour). */
export type BugFlags = Record<BugKey, boolean>;

export const BUG_INFO: Record<BugKey, { title: string; broken: string; fixed: string }> = {
  couponRemovalTotal: {
    title: "Coupon removal total",
    broken: "Removing a coupon clears the discount row but leaves the discounted total.",
    fixed: "Removing a coupon recalculates the total.",
  },
  quantitySubtotal: {
    title: "Quantity subtotal",
    broken: "Changing a quantity updates the line total but not the subtotal or total.",
    fixed: "Changing a quantity recalculates subtotal and total.",
  },
  staleCartBadge: {
    title: "Stale cart badge",
    broken: "Removing the final cart item leaves the old count on the header badge.",
    fixed: "The badge disappears when the cart becomes empty.",
  },
};

export const ALL_BUGS_ENABLED: BugFlags = { couponRemovalTotal: true, quantitySubtotal: true, staleCartBadge: true };
export const ALL_BUGS_FIXED: BugFlags = { couponRemovalTotal: false, quantitySubtotal: false, staleCartBadge: false };
