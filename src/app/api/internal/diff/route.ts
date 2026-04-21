import { type NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { apiReadLimit } from "@/lib/api/rate_limit";

export const runtime = "nodejs";

/**
 * POST /api/internal/diff
 *
 * Server-side proxy for the Cloudflare diff worker. Exists so the
 * worker bearer secret (`DIFF_WORKER_SECRET`) never has to be shipped
 * to the browser.
 *
 * Auth: session cookie via `getRequestContext`. Unauthenticated
 * callers get 401.
 *
 * Body: `{ before: string | null, after: string | null, mode?: "words" | "lines" }`.
 * Both sides are optional (null) but when present must be strings; the
 * combined length is capped at 500_000 chars to keep the edge worker
 * from being abused for DoS-sized payloads.
 *
 * Rate limited at `apiReadLimit` (60 req/min) per authenticated user.
 *
 * On success the worker's response (shape: `DiffResult`) is returned
 * verbatim with status 200. Failures from the worker surface as 502.
 */

const WORKER_TIMEOUT_MS = 3_000;
const MAX_INPUT_CHARS = 500_000;

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
  }

  // ── Rate limit per user (60 req/min) ─────────────────────────────────
  const rl = await apiReadLimit(`diff_proxy:${ctx.user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retry_after: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // ── Parse + validate body ────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "bad_request", message: "body must be an object" },
      { status: 400 },
    );
  }

  const { before, after, mode } = body as {
    before?: unknown;
    after?: unknown;
    mode?: unknown;
  };

  if (!isStringOrNull(before) || !isStringOrNull(after)) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: "`before` and `after` must be strings or null",
      },
      { status: 400 },
    );
  }

  if (mode !== undefined && mode !== "words" && mode !== "lines") {
    return NextResponse.json(
      {
        error: "bad_request",
        message: '`mode` must be "words" or "lines"',
      },
      { status: 400 },
    );
  }

  const beforeLen = before?.length ?? 0;
  const afterLen = after?.length ?? 0;
  if (beforeLen + afterLen > MAX_INPUT_CHARS) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: `input too large (${beforeLen + afterLen} > ${MAX_INPUT_CHARS})`,
      },
      { status: 400 },
    );
  }

  // ── Forward to the CF worker ─────────────────────────────────────────
  const workerUrl = process.env.NEXT_PUBLIC_DIFF_WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json(
      { error: "not_configured", message: "diff worker URL not set" },
      { status: 503 },
    );
  }

  const secret = process.env.DIFF_WORKER_SECRET;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${workerUrl}/diff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ before, after, mode }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Pass through upstream status; surface upstream body as-is so the
    // client sees the same shape the worker produced.
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    clearTimeout(timeout);
    return NextResponse.json(
      { error: "upstream_unavailable" },
      { status: 502 },
    );
  }
}
