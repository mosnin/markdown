import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";

/**
 * Browserbase wrapper for the `browse_session_*` agent tools.
 *
 * A Browserbase session is a remote Chrome instance that persists cookies
 * and page state across individual steps. We open a fresh Playwright CDP
 * connection per step and close it immediately — Browserbase bills per
 * session-minute, not per CDP connection, so holding the Playwright
 * client open between steps would only risk stale sockets.
 */

export interface BrowserbaseSessionInfo {
  sessionId: string;
  liveUrl: string | null;
  connectUrl: string;
}

export interface BrowserbaseStepResult {
  url: string | null;
  extracted_content: string | null;
  screenshot_url: string | null;
  action_took_ms: number;
}

const EXTRACTION_MAX_CHARS = 32_768;
const NAVIGATE_TIMEOUT_MS = 20_000;
const INTERACTION_TIMEOUT_MS = 10_000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function getClient(): Browserbase {
  return new Browserbase({ apiKey: requireEnv("BROWSERBASE_API_KEY") });
}

export async function startBrowserbaseSession(): Promise<BrowserbaseSessionInfo> {
  const projectId = requireEnv("BROWSERBASE_PROJECT_ID");
  requireEnv("BROWSERBASE_API_KEY");
  const bb = getClient();
  const session = await bb.sessions.create({ projectId });
  const liveUrl =
    (session as { liveURLs?: { debuggerUrl?: string | null } }).liveURLs
      ?.debuggerUrl ?? null;
  return {
    sessionId: session.id,
    liveUrl,
    connectUrl: session.connectUrl,
  };
}

export async function runBrowserbaseStep(
  connectUrl: string,
  params: {
    action: "navigate" | "click" | "fill" | "extract" | "screenshot";
    url?: string;
    selector?: string;
    value?: string;
    extraction_mode?: "readable" | "full_html";
  }
): Promise<BrowserbaseStepResult> {
  const browser = await chromium.connectOverCDP(connectUrl);
  const startedAt = Date.now();
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    switch (params.action) {
      case "navigate": {
        if (!params.url) throw new Error("url is required for navigate");
        await page.goto(params.url, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATE_TIMEOUT_MS,
        });
        return {
          url: page.url(),
          extracted_content: null,
          screenshot_url: null,
          action_took_ms: Date.now() - startedAt,
        };
      }
      case "click": {
        if (!params.selector) throw new Error("selector is required for click");
        await page.click(params.selector, { timeout: INTERACTION_TIMEOUT_MS });
        return {
          url: page.url(),
          extracted_content: null,
          screenshot_url: null,
          action_took_ms: Date.now() - startedAt,
        };
      }
      case "fill": {
        if (!params.selector) throw new Error("selector is required for fill");
        await page.fill(params.selector, params.value ?? "", {
          timeout: INTERACTION_TIMEOUT_MS,
        });
        return {
          url: page.url(),
          extracted_content: null,
          screenshot_url: null,
          action_took_ms: Date.now() - startedAt,
        };
      }
      case "extract": {
        const mode = params.extraction_mode ?? "readable";
        const raw =
          mode === "full_html"
            ? await page.content()
            : await page.innerText("body");
        const capped = raw.slice(0, EXTRACTION_MAX_CHARS);
        return {
          url: page.url(),
          extracted_content: capped,
          screenshot_url: null,
          action_took_ms: Date.now() - startedAt,
        };
      }
      case "screenshot": {
        // v1: capture but do not persist — durable storage is deferred.
        await page.screenshot({ type: "png" });
        return {
          url: page.url(),
          extracted_content: null,
          screenshot_url: null,
          action_took_ms: Date.now() - startedAt,
        };
      }
      default: {
        const exhaustive: never = params.action;
        throw new Error(`unsupported action: ${String(exhaustive)}`);
      }
    }
  } finally {
    // Always close — keeps CDP sockets tidy; the Browserbase session itself
    // persists independently until REQUEST_RELEASE.
    await browser.close().catch(() => {});
  }
}

export async function endBrowserbaseSession(sessionId: string): Promise<void> {
  const apiKey = requireEnv("BROWSERBASE_API_KEY");
  const projectId = requireEnv("BROWSERBASE_PROJECT_ID");

  const bb = getClient();
  const sessions = bb.sessions as unknown as {
    update?: (
      id: string,
      body: { status: "REQUEST_RELEASE"; projectId: string }
    ) => Promise<unknown>;
  };

  if (typeof sessions.update === "function") {
    try {
      await sessions.update(sessionId, {
        status: "REQUEST_RELEASE",
        projectId,
      });
      return;
    } catch {
      // fall through to REST fallback
    }
  }

  const res = await fetch(
    `https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-BB-API-Key": apiKey,
      },
      body: JSON.stringify({ status: "REQUEST_RELEASE", projectId }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Browserbase release failed: ${res.status} ${detail.slice(0, 200)}`
    );
  }
}
