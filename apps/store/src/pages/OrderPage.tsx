import { Link, useLocation, useParams } from "react-router";
import { formatMoney } from "@reprolab/shared";

export function OrderPage() {
  const { orderId } = useParams();
  const state = useLocation().state as { totalCents?: number } | null;

  return (
    <div className="empty-state" data-testid="order-confirmation">
      <h1>Thank you!</h1>
      <p>
        Order <strong>{orderId}</strong> is confirmed
        {typeof state?.totalCents === "number" ? ` (simulated charge ${formatMoney(state.totalCents)})` : ""}.
      </p>
      <Link to="/" className="button" data-testid="back-to-shop">
        Back to the shop
      </Link>
    </div>
  );
}
