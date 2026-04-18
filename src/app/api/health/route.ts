import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/health
 *
 * Public health check endpoint — no authentication required.
 *
 * Checks:
 *   - Supabase DB connectivity (SELECT 1)
 *   - Required env vars in production (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SENTRY_DSN)
 *
 * Returns 200 on success, 503 on degraded state (DB unreachable).
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const timestamp = new Date().toISOString();

  // Check Sentry DSN presence
  const sentryConfigured = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

  // In production, verify required env vars
  if (process.env.NODE_ENV === "production") {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        {
          status: "degraded",
          db: "error",
          error: "NEXT_PUBLIC_SUPABASE_URL is not set",
          timestamp,
        },
        { status: 503, headers }
      );
    }
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
      // Sentry missing is not fatal — we report it but don't degrade
    }
  }

  // Check DB connectivity
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("workspaces")
      .select("id")
      .limit(1)
      .maybeSingle();

    // Even if the query returns no rows, as long as it doesn't error
    // the DB is reachable. We use a lightweight query on an existing
    // table since Supabase JS client doesn't support raw `SELECT 1`.
    if (error) {
      return NextResponse.json(
        {
          status: "degraded",
          db: "error",
          error: error.message,
          timestamp,
        },
        { status: 503, headers }
      );
    }

    return NextResponse.json(
      {
        status: "ok",
        db: "connected",
        sentry: sentryConfigured,
        timestamp,
      },
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        status: "degraded",
        db: "error",
        error: message,
        timestamp,
      },
      { status: 503, headers }
    );
  }
}
