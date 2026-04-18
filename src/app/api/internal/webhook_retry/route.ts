import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryFailedDeliveries } from "@/server/services/content_webhook_service";

export const runtime = "nodejs";

/**
 * POST /api/internal/webhook_retry
 *
 * Cron endpoint that retries failed content webhook deliveries.
 * Authenticated via the platform-level `WEBHOOK_RETRY_CRON_TOKEN` env
 * var. Callers pass the token in the `Authorization: Bearer <token>`
 * header.
 *
 * Wire via Vercel Cron (every 5 minutes) or any external scheduler
 * that can POST with the bearer token. The
 * endpoint is idempotent — retries are gated by next_retry_at and
 * max attempt counts.
 *
 * Response shape: `{ ok, retried, permanently_failed }`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_RETRY_CRON_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "WEBHOOK_RETRY_CRON_TOKEN not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!presented || presented !== secret) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const admin = createAdminClient();
  const result = await retryFailedDeliveries(admin);

  return NextResponse.json({
    ok: true,
    retried: result.retried,
    permanently_failed: result.permanentlyFailed,
  });
}
