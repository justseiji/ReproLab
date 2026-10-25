import { describe, expect, it } from "vitest";
import { checkUrl, normalizeOrigin, storeRouteUrl, type StoreRoute } from "../src";

const allowed = [normalizeOrigin("http://localhost:4100")];

describe("browser destination policy", () => {
  it("allows the store origin on any path", () => {
    for (const url of ["http://localhost:4100/", "http://localhost:4100/cart?x=1", "http://localhost:4100/assets/app.js"]) {
      expect(checkUrl(url, allowed).allowed, url).toBe(true);
    }
  });

  it("blocks other hosts, ports and schemes", () => {
    for (const url of [
      "http://localhost:4101/admin/bugs", // the store's admin port
      "http://127.0.0.1:4100/", // same machine, different origin string
      "http://localhost:4000/api/reports", // the ReproLab API
      "https://localhost:4100/",
      "https://evil.test/",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "javascript:alert(1)",
      "ws://localhost:4100/socket",
      "not a url",
    ]) {
      expect(checkUrl(url, allowed).allowed, url).toBe(false);
    }
  });

  it("is not fooled by userinfo or look-alike hosts", () => {
    expect(checkUrl("http://localhost:4100@evil.test/", allowed).allowed).toBe(false);
    expect(checkUrl("http://user:pass@localhost:4100/", allowed).allowed).toBe(false);
    expect(checkUrl("http://localhost:4100.evil.test/", allowed).allowed).toBe(false);
    expect(checkUrl("http://evil.test/?next=http://localhost:4100/", allowed).allowed).toBe(false);
  });

  it("builds navigation URLs only for known store routes", () => {
    expect(storeRouteUrl("/cart", "http://localhost:4100")).toBe("http://localhost:4100/cart");
    expect(() => storeRouteUrl("//evil.test/" as StoreRoute, "http://localhost:4100")).toThrow();
    expect(() => normalizeOrigin("file:///tmp")).toThrow();
  });
});
