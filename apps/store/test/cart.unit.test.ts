import { describe, expect, it } from "vitest";
import { ALL_BUGS_ENABLED, ALL_BUGS_FIXED, computeExpectedCart, findProduct, PRODUCTS, type BugFlags } from "@reprolab/shared";
import { cartReducer, EMPTY_CART, type CartAction, type CartState } from "../src/cart";

const run = (actions: CartAction[], bugs: BugFlags): CartState => actions.reduce((s, a) => cartReducer(s, a, bugs), EMPTY_CART);
const add = (id: string): CartAction => ({ type: "add", product: findProduct(id)! });

/** The store's own numbers must equal the specification's for the same inputs. */
function expectMatchesSpec(state: CartState) {
  const spec = computeExpectedCart(
    state.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    state.couponCode,
  );
  expect({
    subtotal: state.subtotalCents,
    discount: state.discountCents,
    total: state.totalCents,
    items: state.itemCount,
  }).toEqual({ subtotal: spec.subtotalCents, discount: spec.discountCents, total: spec.totalCents, items: spec.itemCount });
}

describe("demo store cart (all bugs fixed)", () => {
  it("matches the specification for each seeded scenario", () => {
    expectMatchesSpec(run([add("canvas-tote"), { type: "applyCoupon", code: "SAVE10" }, { type: "removeCoupon" }], ALL_BUGS_FIXED));
    expectMatchesSpec(run([add("ceramic-mug"), { type: "setQuantity", productId: "ceramic-mug", quantity: 3 }], ALL_BUGS_FIXED));
    expectMatchesSpec(run([add("notebook-set"), { type: "remove", productId: "notebook-set" }], ALL_BUGS_FIXED));
  });

  it("matches the specification across many deterministic random action sequences", () => {
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

    for (let sequence = 0; sequence < 200; sequence++) {
      let state = EMPTY_CART;
      for (let step = 0; step < 12; step++) {
        const product = pick(PRODUCTS);
        const action = pick<CartAction>([
          { type: "add", product },
          { type: "setQuantity", productId: product.id, quantity: 1 + Math.floor(random() * 10) },
          { type: "remove", productId: product.id },
          { type: "applyCoupon", code: pick(["SAVE10", "WELCOME5", "BOGUS"]) },
          { type: "removeCoupon" },
        ]);
        state = cartReducer(state, action, ALL_BUGS_FIXED);
        expectMatchesSpec(state);
      }
    }
  });

  it("rejects unknown coupons and coupons on an empty cart", () => {
    expect(run([{ type: "applyCoupon", code: "SAVE10" }], ALL_BUGS_FIXED).couponCode).toBeNull();
    const bogus = run([add("canvas-tote"), { type: "applyCoupon", code: "BOGUS" }], ALL_BUGS_FIXED);
    expect(bogus.couponCode).toBeNull();
    expect(bogus.message?.kind).toBe("error");
  });

  it("clamps quantities to 1..10", () => {
    const state = run([add("canvas-tote"), { type: "setQuantity", productId: "canvas-tote", quantity: 40 }], ALL_BUGS_FIXED);
    expect(state.lines[0]!.quantity).toBe(10);
  });
});

describe("demo store cart (bugs enabled)", () => {
  it("couponRemovalTotal: removing a coupon leaves the discounted total", () => {
    const state = run([add("canvas-tote"), { type: "applyCoupon", code: "SAVE10" }, { type: "removeCoupon" }], ALL_BUGS_ENABLED);
    expect(state).toMatchObject({ couponCode: null, discountCents: 0, subtotalCents: 2400, totalCents: 2160 });
  });

  it("quantitySubtotal: changing quantity leaves subtotal and total stale", () => {
    const state = run([add("ceramic-mug"), { type: "setQuantity", productId: "ceramic-mug", quantity: 3 }], ALL_BUGS_ENABLED);
    expect(state).toMatchObject({ subtotalCents: 1800, totalCents: 1800, itemCount: 3 });
    expect(state.lines[0]!.quantity).toBe(3);
  });

  it("staleCartBadge: removing the final item leaves the old badge count", () => {
    const state = run([add("notebook-set"), { type: "remove", productId: "notebook-set" }], ALL_BUGS_ENABLED);
    expect(state).toMatchObject({ lines: [], itemCount: 1, totalCents: 0 });
  });

  it("each bug only affects its own scenario", () => {
    // With only the badge bug on, coupon removal and quantity changes still match the spec.
    const onlyBadge = { ...ALL_BUGS_FIXED, staleCartBadge: true };
    expectMatchesSpec(run([add("canvas-tote"), { type: "applyCoupon", code: "SAVE10" }, { type: "removeCoupon" }], onlyBadge));
    expectMatchesSpec(run([add("ceramic-mug"), { type: "setQuantity", productId: "ceramic-mug", quantity: 3 }], onlyBadge));
    // Removing a non-final item is unaffected by the badge bug.
    expectMatchesSpec(run([add("canvas-tote"), add("ceramic-mug"), { type: "remove", productId: "canvas-tote" }], onlyBadge));
  });
});
