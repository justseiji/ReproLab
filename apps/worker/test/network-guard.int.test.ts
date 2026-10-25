import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installNetworkGuard } from "../src/engine/network-guard";

/**
 * Two real local servers: "store" (allowed) and "outside" (must never be
 * contacted). Every request the outside server receives is a policy failure.
 */
let store: Server;
let outside: Server;
let storeOrigin: string;
let outsideOrigin: string;
let outsideHits: string[] = [];
let browser: Browser;
let context: BrowserContext;
let blocked: Array<{ url: string; reason: string }> = [];

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

beforeAll(async () => {
  outside = createServer((req, res) => {
    outsideHits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" }).end("<p>outside</p>");
  });
  outsideOrigin = await listen(outside);

  store = createServer((req, res) => {
    if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>store</title>
        <img src="${outsideOrigin}/pixel.png">
        <script>fetch("${outsideOrigin}/exfiltrate?d=1").catch(() => { document.title = "fetch blocked"; });</script>`);
    } else if (req.url === "/redirect-out") {
      res.writeHead(302, { location: `${outsideOrigin}/landing` }).end();
    } else if (req.url === "/redirect-in") {
      res.writeHead(302, { location: "/landing" }).end();
    } else {
      res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>landing</title><p>landed</p>");
    }
  });
  storeOrigin = await listen(store);
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  await context?.close();
  outsideHits = [];
  blocked = [];
  context = await browser.newContext({ serviceWorkers: "block" });
  await installNetworkGuard(context, [storeOrigin], (url, reason) => blocked.push({ url, reason }));
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
  store?.close();
  outside?.close();
});

describe("browser network guard", () => {
  it("blocks sub-resources and fetches to other origins", async () => {
    const page = await context.newPage();
    await page.goto(`${storeOrigin}/page`);
    await page.waitForFunction(() => document.title === "fetch blocked");
    expect(outsideHits).toEqual([]);
    expect(blocked.map((b) => new URL(b.url).pathname).sort()).toEqual(["/exfiltrate", "/pixel.png"]);
  });

  it("blocks direct navigation to another origin", async () => {
    const page = await context.newPage();
    await expect(page.goto(`${outsideOrigin}/`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(outsideHits).toEqual([]);
  });

  it("blocks a redirect from the allowed origin to another origin", async () => {
    const page = await context.newPage();
    await expect(page.goto(`${storeOrigin}/redirect-out`)).rejects.toThrow();
    expect(outsideHits).toEqual([]);
    expect(blocked[0]?.reason).toMatch(/Redirect blocked/);
  });

  it("allows redirects that stay on the allowed origin", async () => {
    const page = await context.newPage();
    await page.goto(`${storeOrigin}/redirect-in`);
    expect(new URL(page.url()).pathname).toBe("/landing");
    expect(await page.title()).toBe("landing");
    expect(blocked).toEqual([]);
  });
});
