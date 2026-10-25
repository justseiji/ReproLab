import { formatMoney, TEST_IDS } from "@reprolab/shared";
import { StatusMessage } from "../StatusMessage";
import { useStore } from "../store-context";

export function CatalogPage() {
  const { products, dispatch } = useStore();

  return (
    <>
      <div className="page-heading">
        <h1>Everyday goods, made well</h1>
        <p className="muted">Small-batch homeware and stationery. Free returns within 30 days.</p>
      </div>
      <StatusMessage />
      <ul className="product-grid">
        {products.map((product) => (
          <li key={product.id} className="product-card">
            <div className="product-art" style={{ background: product.accent }} aria-hidden="true">
              {product.name
                .split(" ")
                .map((word) => word[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="product-body">
              <p className="eyebrow">{product.category}</p>
              <h2>{product.name}</h2>
              <p className="muted">{product.description}</p>
              <div className="product-footer">
                <span className="price">{formatMoney(product.priceCents)}</span>
                <button
                  type="button"
                  className="button primary"
                  data-testid={TEST_IDS.addToCart(product.id)}
                  aria-label={`Add ${product.name} to cart`}
                  onClick={() => dispatch({ type: "add", product })}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
