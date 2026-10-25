import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { formatMoney } from "@reprolab/shared";
import { useStore } from "../store-context";

export function CheckoutPage() {
  const { cart, dispatch } = useStore();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cart.lines.length === 0) {
    return (
      <div className="empty-state">
        <h1>Checkout</h1>
        <p>Your cart is empty.</p>
        <Link to="/" className="button" data-testid="continue-shopping">
          Continue shopping
        </Link>
      </div>
    );
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          lines: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          couponCode: cart.couponCode,
        }),
      });
      if (!res.ok) throw new Error("Order failed");
      const order = (await res.json()) as { orderId: string; totalCents: number };
      dispatch({ type: "clear" });
      navigate(`/order/${order.orderId}`, { state: order });
    } catch {
      setError("We couldn't place your order. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="checkout">
      <div className="page-heading">
        <h1>Checkout</h1>
        <p className="muted">Simulated checkout — no payment details are collected.</p>
      </div>
      <form className="card form" onSubmit={placeOrder}>
        <label htmlFor="name">Full name</label>
        <input id="name" name="name" required autoComplete="off" data-testid="checkout-name" />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="off" data-testid="checkout-email" />
        <p className="checkout-total">
          Order total <strong>{formatMoney(cart.totalCents)}</strong>
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button type="submit" className="button primary block" disabled={submitting} data-testid="place-order">
          {submitting ? "Placing order…" : "Place order (demo)"}
        </button>
      </form>
    </div>
  );
}
