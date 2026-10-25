import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { formatMoney, MAX_QUANTITY, TEST_IDS } from "@reprolab/shared";
import { StatusMessage } from "../StatusMessage";
import { useStore } from "../store-context";

const QUANTITIES = Array.from({ length: MAX_QUANTITY }, (_, i) => i + 1);

export function CartPage() {
  const { cart, dispatch } = useStore();
  const [code, setCode] = useState("");

  function applyCoupon(event: FormEvent) {
    event.preventDefault();
    dispatch({ type: "applyCoupon", code });
    setCode("");
  }

  return (
    <>
      <div className="page-heading">
        <h1>Your cart</h1>
      </div>
      <StatusMessage />

      {cart.lines.length === 0 ? (
        <div className="empty-state" data-testid={TEST_IDS.cartEmpty}>
          <p>Your cart is empty.</p>
          <Link to="/" className="button" data-testid="continue-shopping">
            Continue shopping
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <ul className="cart-lines" aria-label="Cart items">
            {cart.lines.map((line) => (
              <li key={line.productId} className="cart-line" data-testid={TEST_IDS.cartLine(line.productId)} data-product-id={line.productId}>
                <div>
                  <h2 className="line-name">{line.name}</h2>
                  <p className="muted" data-testid={`unit-price-${line.productId}`}>
                    {formatMoney(line.unitPriceCents)} each
                  </p>
                </div>
                <label className="qty">
                  <span className="sr-only">Quantity for {line.name}</span>
                  <select
                    data-testid={TEST_IDS.quantitySelect(line.productId)}
                    aria-label={`Quantity for ${line.name}`}
                    value={line.quantity}
                    onChange={(e) => dispatch({ type: "setQuantity", productId: line.productId, quantity: Number(e.target.value) })}
                  >
                    {QUANTITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="line-total" data-testid={TEST_IDS.lineTotal(line.productId)}>
                  {formatMoney(line.unitPriceCents * line.quantity)}
                </span>
                <button
                  type="button"
                  className="link-button danger"
                  data-testid={TEST_IDS.removeItem(line.productId)}
                  aria-label={`Remove ${line.name}`}
                  onClick={() => dispatch({ type: "remove", productId: line.productId })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <aside className="summary" aria-label="Order summary">
            {cart.couponCode ? (
              <div className="coupon-applied">
                <span>
                  Coupon <strong data-testid={TEST_IDS.appliedCoupon}>{cart.couponCode}</strong>
                </span>
                <button
                  type="button"
                  className="link-button"
                  data-testid={TEST_IDS.removeCoupon}
                  onClick={() => dispatch({ type: "removeCoupon" })}
                >
                  Remove coupon
                </button>
              </div>
            ) : (
              <form className="coupon-form" onSubmit={applyCoupon}>
                <label htmlFor="coupon">Coupon code</label>
                <div className="inline">
                  <input
                    id="coupon"
                    data-testid={TEST_IDS.couponInput}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. SAVE10"
                    autoComplete="off"
                  />
                  <button type="submit" className="button" data-testid={TEST_IDS.applyCoupon}>
                    Apply
                  </button>
                </div>
              </form>
            )}

            <dl className="totals">
              <div>
                <dt>Subtotal</dt>
                <dd data-testid={TEST_IDS.subtotal}>{formatMoney(cart.subtotalCents)}</dd>
              </div>
              {cart.discountCents !== 0 && (
                <div>
                  <dt>Discount</dt>
                  <dd data-testid={TEST_IDS.discount}>{formatMoney(-cart.discountCents)}</dd>
                </div>
              )}
              <div className="grand-total">
                <dt>Total</dt>
                <dd data-testid={TEST_IDS.total}>{formatMoney(cart.totalCents)}</dd>
              </div>
            </dl>
            <Link to="/checkout" className="button primary block" data-testid="go-to-checkout">
              Checkout
            </Link>
          </aside>
        </div>
      )}
    </>
  );
}
