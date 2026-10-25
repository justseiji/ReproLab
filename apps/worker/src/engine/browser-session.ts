import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import {
  checkUrl,
  storeRouteUrl,
  TEST_IDS,
  type BrowserAction,
  type ElementLocator,
  type EvidenceKind,
  type PageObservation,
} from "@reprolab/shared";
import { InfraError, isBrowserGoneError } from "../errors";
import { installNetworkGuard } from "./network-guard";
import { blankObservation, observePage } from "./observe";

export interface SessionOptions {
  storeOrigin: string;
  headless: boolean;
  actionTimeoutMs: number;
  onEvidence: (kind: EvidenceKind, message: string, url: string | null) => void;
}

export type ExecutionResult = { ok: true } | { ok: false; error: string };

/** Drops query strings and fragments so recorded URLs cannot carry tokens. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.protocol.startsWith("http") ? `${url.origin}${url.pathname}` : url.protocol;
  } catch {
    return "(invalid url)";
  }
}

/**
 * One isolated browser for one run attempt. Each session launches its own
 * Chromium with a fresh context (no cookies, storage or service workers), so
 * runs can never affect each other. close() is safe to call at any time.
 */
export class BrowserSession {
  /** Set when the page tried to leave the allowed origin. */
  navigationBlocked: string | null = null;
  private tracing = false;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    readonly page: Page,
    private readonly options: SessionOptions,
  ) {}

  static async launch(options: SessionOptions): Promise<BrowserSession> {
    let browser: Browser;
    try {
      browser = await chromium.launch({ headless: options.headless, timeout: 30_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = /Executable doesn't exist|npx playwright install/i.test(message);
      throw new InfraError(
        "BROWSER_FAILED",
        missing
          ? "Chromium is not installed. Run: npx playwright install chromium"
          : `Could not launch the browser: ${message.split("\n")[0]}`,
        !missing,
      );
    }
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
        acceptDownloads: false,
        permissions: [],
        locale: "en-US",
        timezoneId: "UTC",
      });
      const session = new BrowserSession(browser, context, await context.newPage(), options);
      await session.wire();
      return session;
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  private async wire(): Promise<void> {
    const { onEvidence, storeOrigin } = this.options;
    await installNetworkGuard(this.context, [storeOrigin], (url, reason) =>
      onEvidence("request_blocked", reason, redactUrl(url)),
    );

    // Popups are closed immediately; the agent works in a single tab.
    this.context.on("page", (popup) => {
      if (popup !== this.page) {
        onEvidence("request_blocked", "Popup window closed", redactUrl(popup.url()));
        void popup.close().catch(() => {});
      }
    });
    this.page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
    this.page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("ERR_BLOCKED_BY_CLIENT")) {
        onEvidence("console_error", msg.text().slice(0, 500), msg.location().url ? redactUrl(msg.location().url) : null);
      }
    });
    this.page.on("pageerror", (error) => onEvidence("page_error", error.message.slice(0, 500), null));
    this.page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "failed";
      if (!failure.includes("ERR_BLOCKED_BY_CLIENT")) onEvidence("request_failed", failure, redactUrl(request.url()));
    });
    this.page.on("response", (response) => {
      if (response.status() >= 400) {
        onEvidence("http_error", `HTTP ${response.status()} ${response.request().method()}`, redactUrl(response.url()));
      }
    });
    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page.mainFrame()) return;
      const url = frame.url();
      if (url !== "about:blank" && !checkUrl(url, [storeOrigin]).allowed) this.navigationBlocked = redactUrl(url);
    });
  }

  async startTracing(): Promise<void> {
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    this.tracing = true;
  }

  async stopTracing(path: string): Promise<boolean> {
    if (!this.tracing) return false;
    this.tracing = false;
    await this.context.tracing.stop({ path });
    return true;
  }

  async observe(): Promise<PageObservation> {
    if (this.page.url() === "about:blank") return blankObservation("about:blank");
    try {
      return await observePage(this.page);
    } catch (error) {
      if (isBrowserGoneError(error)) throw new InfraError("BROWSER_FAILED", "The browser closed unexpectedly.", true);
      // A page in the middle of navigating can reject evaluate(); retry once.
      await this.page.waitForLoadState("domcontentloaded", { timeout: this.options.actionTimeoutMs }).catch(() => {});
      return observePage(this.page);
    }
  }

  private locate(locator: ElementLocator): Locator {
    return locator.kind === "testId"
      ? this.page.getByTestId(locator.testId)
      : this.page.getByRole(locator.role as Parameters<Page["getByRole"]>[0], { name: locator.name, exact: true });
  }

  /**
   * Executes an action that has already been validated against the schema
   * and the current observation. Page-level failures (element gone, timeout)
   * are returned as step failures; a dead browser is an infrastructure error.
   */
  async execute(action: BrowserAction, locator: ElementLocator | null): Promise<ExecutionResult> {
    const timeout = this.options.actionTimeoutMs;
    try {
      if (action.type === "navigate") {
        await this.page.goto(storeRouteUrl(action.route, this.options.storeOrigin), { waitUntil: "domcontentloaded", timeout });
        await this.page.getByTestId(TEST_IDS.header).waitFor({ state: "visible", timeout });
      } else if (action.type !== "inspect") {
        if (!locator) return { ok: false, error: "No locator for element." };
        const target = this.locate(locator);
        const count = await target.count();
        if (count !== 1) return { ok: false, error: `Locator matched ${count} elements; expected exactly one.` };
        if (action.type === "click") await target.click({ timeout });
        else if (action.type === "fill") await target.fill(action.value, { timeout });
        else await target.selectOption({ label: action.option }, { timeout });
      }
      // Let React re-render and any requests settle before the next observation.
      await this.page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
      return { ok: true };
    } catch (error) {
      if (isBrowserGoneError(error)) throw new InfraError("BROWSER_FAILED", "The browser closed unexpectedly.", true);
      const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
      return { ok: false, error: message.slice(0, 300) };
    }
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ type: "jpeg", quality: 70, timeout: this.options.actionTimeoutMs });
  }

  /** Closes the browser, bounded so a hung browser cannot block the worker. */
  async close(): Promise<void> {
    await Promise.race([
      this.browser.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
}
