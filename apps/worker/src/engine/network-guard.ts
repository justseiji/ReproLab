import type { BrowserContext } from "playwright";
import { checkUrl } from "@reprolab/shared";

export type BlockedHandler = (url: string, reason: string) => void;

/**
 * Restricts every request from the browser context to the allowed origins.
 *
 * Playwright only routes the first hop of a redirect chain, so allowed
 * requests are fetched here with redirects disabled. If the response is a
 * redirect, its Location is checked before the browser is allowed to follow
 * it; the browser's follow-up request then passes through this guard again.
 */
export async function installNetworkGuard(
  context: BrowserContext,
  allowedOrigins: readonly string[],
  onBlocked: BlockedHandler,
): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const decision = checkUrl(request.url(), allowedOrigins);
    if (!decision.allowed) {
      onBlocked(request.url(), decision.reason);
      await route.abort("blockedbyclient");
      return;
    }

    let response;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch {
      // Connection errors surface to the page as a failed request.
      await route.abort("failed").catch(() => {});
      return;
    }

    const location = response.headers()["location"];
    if (response.status() >= 300 && response.status() < 400 && location) {
      const target = new URL(location, request.url()).href;
      const redirectDecision = checkUrl(target, allowedOrigins);
      if (!redirectDecision.allowed) {
        onBlocked(target, `Redirect blocked: ${redirectDecision.reason}`);
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.fulfill({ response });
  });

  await context.routeWebSocket(/.*/, (ws) => {
    const decision = checkUrl(ws.url().replace(/^ws/, "http"), allowedOrigins);
    if (!decision.allowed) {
      onBlocked(ws.url(), decision.reason);
      ws.close();
      return;
    }
    ws.connectToServer();
  });
}
