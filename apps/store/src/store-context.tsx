import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import type { BugFlags, Product } from "@reprolab/shared";
import { cartReducer, loadCart, saveCart, type CartAction, type CartState } from "./cart";

interface StoreValue {
  products: Product[];
  cart: CartState;
  dispatch: (action: CartAction) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider(props: { products: Product[]; bugs: BugFlags; children: ReactNode }) {
  const { products, bugs } = props;
  const [cart, dispatch] = useReducer((state: CartState, action: CartAction) => cartReducer(state, action, bugs), undefined, loadCart);

  useEffect(() => saveCart(cart), [cart]);

  return <StoreContext.Provider value={{ products, cart, dispatch }}>{props.children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}
