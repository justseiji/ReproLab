import { Link, NavLink, Route, Routes } from "react-router";
import { TEST_IDS } from "@reprolab/shared";
import { useStore } from "./store-context";
import { CartPage } from "./pages/CartPage";
import { CatalogPage } from "./pages/CatalogPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { OrderPage } from "./pages/OrderPage";

export function App() {
  const { cart } = useStore();
  const count = cart.itemCount;

  return (
    <>
      <div className="demo-banner">Demo store for ReproLab — no real payments are taken.</div>
      <header className="site-header" data-testid={TEST_IDS.header}>
        <div className="container header-inner">
          <Link to="/" className="brand" data-testid="nav-brand">
            <span className="brand-mark" aria-hidden="true">H</span>
            Harbor &amp; Pine
          </Link>
          <nav aria-label="Main">
            <NavLink to="/" end data-testid="nav-shop">
              Shop
            </NavLink>
            <NavLink to="/cart" className="cart-link" data-testid="nav-cart">
              Cart
              {count > 0 && (
                <span className="badge" data-testid={TEST_IDS.badge} aria-label={`${count} items in cart`}>
                  {count}
                </span>
              )}
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="container page">
        <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order/:orderId" element={<OrderPage />} />
          <Route path="*" element={<p>Page not found. <Link to="/" data-testid="not-found-home">Back to the shop</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
