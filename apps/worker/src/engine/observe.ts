import type { Page } from "playwright";
import {
  parseMoney,
  TEST_IDS,
  type CartLineObservation,
  type CartObservation,
  type ObservedElement,
  type PageObservation,
} from "@reprolab/shared";

/**
 * Reads the page into a PageObservation. The in-page part is a fixed script
 * written by us (no model output ever reaches page.evaluate). It is kept as a
 * plain string so that bundler transforms cannot inject helper calls into code
 * that runs inside the browser.
 */
const OBSERVE_SCRIPT = `(() => {
  const T = ${JSON.stringify({
    badge: TEST_IDS.badge,
    subtotal: TEST_IDS.subtotal,
    discount: TEST_IDS.discount,
    total: TEST_IDS.total,
    appliedCoupon: TEST_IDS.appliedCoupon,
    cartEmpty: TEST_IDS.cartEmpty,
    cartLinePrefix: TEST_IDS.cartLine(""),
    lineTotalPrefix: TEST_IDS.lineTotal(""),
  })};
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : "");
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "..." : s);
  const byTestId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const visibleText = (id) => { const el = byTestId(id); return visible(el) ? text(el) : null; };

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return type;
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "number") return "spinbutton";
      return "textbox";
    }
    return "generic";
  };
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const joined = labelledBy.split(/\\s+/).map((id) => text(document.getElementById(id))).join(" ").trim();
      if (joined) return joined;
    }
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && text(label)) return text(label);
    }
    const wrapping = el.closest("label");
    if (wrapping && text(wrapping)) return text(wrapping);
    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return el.getAttribute("placeholder") || el.getAttribute("title") || "";
    return text(el) || el.getAttribute("title") || "";
  };

  const selector = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"]';
  const nodes = Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, 80);
  const elements = nodes.map((el, i) => ({
    id: "e" + (i + 1),
    role: roleOf(el),
    name: clip(nameOf(el), 80),
    tag: el.tagName.toLowerCase(),
    testId: el.getAttribute("data-testid"),
    inputType: el.tagName === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase() : null,
    value: ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) ? clip(String(el.value), 100) : null,
    options: el.tagName === "SELECT" ? Array.from(el.options).map((o) => text(o)) : null,
    disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
  }));

  const lineNodes = Array.from(document.querySelectorAll('[data-testid^="' + T.cartLinePrefix + '"]'));
  const emptyEl = byTestId(T.cartEmpty);
  const onCartPage = location.pathname === "/cart" && (lineNodes.length > 0 || visible(emptyEl));
  const badge = byTestId(T.badge);

  return {
    url: location.href,
    path: location.pathname,
    title: document.title,
    headings: Array.from(document.querySelectorAll("h1, h2")).filter(visible).map(text).slice(0, 12),
    messages: Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).map(text).filter(Boolean).slice(0, 5),
    elements,
    textExcerpt: clip((document.body ? document.body.innerText : "").replace(/\\s+/g, " ").trim(), 2000),
    cartRaw: {
      onCartPage,
      badgeVisible: visible(badge),
      badgeText: visible(badge) ? text(badge) : null,
      lines: onCartPage
        ? lineNodes.map((node) => {
            const productId = node.getAttribute("data-product-id") || "";
            const select = node.querySelector("select");
            const total = node.querySelector('[data-testid="' + T.lineTotalPrefix + productId + '"]');
            const heading = node.querySelector("h2, h3");
            return { productId, name: text(heading), quantity: select ? select.value : null, lineTotalText: total ? text(total) : null };
          })
        : null,
      couponCode: visibleText(T.appliedCoupon),
      subtotalText: visibleText(T.subtotal),
      discountText: visibleText(T.discount),
      totalText: visibleText(T.total),
      emptyStateVisible: visible(emptyEl),
    },
  };
})()`;

interface RawObservation extends Omit<PageObservation, "cart"> {
  cartRaw: {
    onCartPage: boolean;
    badgeVisible: boolean;
    badgeText: string | null;
    lines: Array<{ productId: string; name: string; quantity: string | null; lineTotalText: string | null }> | null;
    couponCode: string | null;
    subtotalText: string | null;
    discountText: string | null;
    totalText: string | null;
    emptyStateVisible: boolean;
  };
}

function toCartObservation(raw: RawObservation["cartRaw"]): CartObservation {
  const lines: CartLineObservation[] | null = raw.lines
    ? raw.lines.map((l) => {
        const quantity = l.quantity === null ? null : Number.parseInt(l.quantity, 10);
        return {
          productId: l.productId,
          name: l.name,
          quantity: Number.isFinite(quantity) ? quantity : null,
          unitPriceCents: null,
          lineTotalCents: parseMoney(l.lineTotalText),
        };
      })
    : null;
  const badgeCount = raw.badgeVisible ? Number.parseInt(raw.badgeText ?? "", 10) : 0;
  return {
    onCartPage: raw.onCartPage,
    badgeVisible: raw.badgeVisible,
    badgeCount: Number.isFinite(badgeCount) ? badgeCount : 0,
    lines,
    couponCode: raw.couponCode ? raw.couponCode.trim().toUpperCase() : null,
    subtotalCents: parseMoney(raw.subtotalText),
    discountCents: parseMoney(raw.discountText),
    totalCents: parseMoney(raw.totalText),
    emptyStateVisible: raw.emptyStateVisible,
  };
}

export async function observePage(page: Page): Promise<PageObservation> {
  const raw = (await page.evaluate(OBSERVE_SCRIPT)) as RawObservation;
  const { cartRaw, ...rest } = raw;
  return { ...rest, elements: rest.elements as ObservedElement[], cart: toCartObservation(cartRaw) };
}

/** Observation of a blank page (before the first navigation). */
export function blankObservation(url: string): PageObservation {
  return {
    url,
    path: "",
    title: "",
    headings: [],
    messages: [],
    elements: [],
    textExcerpt: "",
    cart: {
      onCartPage: false,
      badgeVisible: false,
      badgeCount: 0,
      lines: null,
      couponCode: null,
      subtotalCents: null,
      discountCents: null,
      totalCents: null,
      emptyStateVisible: false,
    },
  };
}
