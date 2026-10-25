import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import type { BugFlags, Product } from "@reprolab/shared";
import { App } from "./App";
import { StoreProvider } from "./store-context";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

async function boot() {
  try {
    const [configRes, productsRes] = await Promise.all([fetch("/api/config"), fetch("/api/products")]);
    if (!configRes.ok || !productsRes.ok) throw new Error("The store API returned an error.");
    const config = (await configRes.json()) as { bugs: BugFlags };
    const { products } = (await productsRes.json()) as { products: Product[] };
    root.render(
      <StrictMode>
        <BrowserRouter>
          <StoreProvider products={products} bugs={config.bugs}>
            <App />
          </StoreProvider>
        </BrowserRouter>
      </StrictMode>,
    );
  } catch (error) {
    console.error("Store failed to load", error);
    root.render(
      <main className="boot-error" role="alert">
        <h1>The store could not load</h1>
        <p>Check that the store server is running, then reload the page.</p>
      </main>,
    );
  }
}

void boot();
