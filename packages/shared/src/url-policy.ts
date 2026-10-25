import { STORE_ROUTES, type StoreRoute } from "./store-spec";

/**
 * Network destination policy for the browser agent. A request is allowed only
 * when its origin (scheme + host + port) exactly matches an allowed origin.
 * Host-name tricks like "http://localhost:4100@evil.test" or
 * "http://localhost:4100.evil.test" fail because the parsed origin differs.
 */
export type UrlDecision = { allowed: true } | { allowed: false; reason: string };

export function normalizeOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) origins can be allowed, got "${parsed.protocol}"`);
  }
  return parsed.origin;
}

export function checkUrl(raw: string, allowedOrigins: readonly string[]): UrlDecision {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { allowed: false, reason: "Not a valid absolute URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reason: `Scheme "${parsed.protocol}" is not allowed.` };
  }
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: "URLs with embedded credentials are not allowed." };
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    return { allowed: false, reason: `Origin ${parsed.origin} is not on the allowlist.` };
  }
  return { allowed: true };
}

export function isStoreRoute(path: string): path is StoreRoute {
  return (STORE_ROUTES as readonly string[]).includes(path);
}

/** Builds a navigation URL. Only known store routes are accepted. */
export function storeRouteUrl(route: StoreRoute, storeOrigin: string): string {
  if (!isStoreRoute(route)) throw new Error(`Unknown store route "${String(route)}"`);
  return new URL(route, storeOrigin).href;
}
