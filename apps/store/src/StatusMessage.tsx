import { useStore } from "./store-context";

/** Announces cart changes to screen readers (and to the reproduction observer). */
export function StatusMessage() {
  const { cart, dispatch } = useStore();
  if (!cart.message) return <div role="status" className="sr-only" />;
  return (
    <div role={cart.message.kind === "error" ? "alert" : "status"} className={`notice ${cart.message.kind}`}>
      <span>{cart.message.text}</span>
      <button type="button" className="link-button" data-testid="dismiss-message" onClick={() => dispatch({ type: "dismissMessage" })}>
        Dismiss
      </button>
    </div>
  );
}
