import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/internal/cleanup
 *
 * General-purpose cleanup endpoint for periodic maintenance tasks.
 * Authenticated via `CLEANUP_CRON_TOKEN` env var — callers pass the
 * token in the `Authorization: Bearer <token>` header.
 *
 * Currently runs:
 *   1. cleanup_expired_webauthn_challenges — purges expired WebAuthn
 *      challenge rows (> 5 minutes old)
 *   2. cleanup_stale_rate_limit_buckets — removes rate-limit window
 *      rows older than 24 hours
 *
 * Wire via Vercel Cron:
 *
 *   // vercel.json
 *   {
 *     "crons": [
 *       { "path": "/api/internal/cleanup", "schedule": "0 * * * *" }
 *     ]
 *   }
 *
 * Response shape: `{ ok, webauthn_challenges_cleaned, rate_limit_buckets_cleaned }`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CLEANUP_CRON_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CLEANUP_CRON_TOKEN not configured" },
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

  const results: Record<string, unknown> = { ok: true };

  // 1. WebAuthn expired challenge cleanup
  try {
    const { error } = await admin.rpc("cleanup_expired_webauthn_challenges");
    if (error) throw error;
    results.webauthn_challenges_cleaned = true;
  } catch (err) {
    results.webauthn_challenges_cleaned = false;
    results.webauthn_challenges_error =
      err instanceof Error ? err.message : String(err);
  }

  // 2. Rate-limit bucket cleanup (stale rows > 24 hours)
  try {
    const { error } = await admin.rpc("cleanup_stale_rate_limit_buckets", {
      older_than_hours: 24,
    });
    if (error) throw error;
    results.rate_limit_buckets_cleaned = true;
  } catch (err) {
    results.rate_limit_buckets_cleaned = false;
    results.rate_limit_buckets_error =
      err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results);
}
