import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDigestBatch } from "@/server/services/email_digest_service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/internal/email_digest
 *
 * External-scheduler cron endpoint that aggregates recent activity per
 * user and emails a digest based on their stored cadence preference.
 *
 * Authenticated via the `x-cron-secret` header matching env
 * `CRON_SECRET`. Not wired to pg_cron — call this from Cloudflare Cron,
 * Supabase Scheduled Functions, or any scheduler that can POST with
 * the header.
 *
 * Body:
 *   { "cadence": "daily" | "weekly" }   // defaults to "daily"
 *
 * Response: the result of `sendDigestBatch`:
 *   { sent: number, skipped: number, failed: number }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const presented = req.headers.get("x-cron-secret") ?? "";
  if (!presented || presented !== secret) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // Body is optional — default cadence to "daily" when absent or malformed.
  let cadence: "daily" | "weekly" = "daily";
  try {
    const raw = (await req.json()) as { cadence?: unknown } | null;
    if (raw && (raw.cadence === "daily" || raw.cadence === "weekly")) {
      cadence = raw.cadence;
    }
  } catch {
    // Empty or non-JSON body — keep default.
  }

  logger.info({ cadence }, "email_digest_batch_start");

  const admin = createAdminClient();
  const result = await sendDigestBatch(admin, cadence);

  logger.info(
    { cadence, sent: result.sent, skipped: result.skipped, failed: result.failed },
    "email_digest_batch_done"
  );

  return NextResponse.json(result);
}
