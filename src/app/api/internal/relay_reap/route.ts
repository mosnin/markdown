import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { reapStaleSessions } from "@/server/services/session_reaper_service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/relay_reap
 *
 * Closes sessions that have gone silent, inferring why.
 *
 * A cron rather than an inline check because the trigger is the ABSENCE of a
 * request: nothing arrives to notice that an agent stopped, so something has
 * to come looking. Every 15 minutes is ample — the threshold is 45.
 *
 *   { "path": "/api/internal/relay_reap", "schedule": "*\/15 * * * *" }
 *
 * Authenticated with EMBED_CRON_TOKEN, the same secret the other internal
 * jobs use.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.EMBED_CRON_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "EMBED_CRON_TOKEN not configured" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  const presentedBuf = Buffer.from(presented);
  const secretBuf = Buffer.from(secret);
  const authorized =
    presentedBuf.length === secretBuf.length &&
    timingSafeEqual(presentedBuf, secretBuf);

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reapStaleSessions(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Session reaping failed");
    return NextResponse.json(
      { ok: false, error: "Session reaping failed" },
      { status: 500 }
    );
  }
}
