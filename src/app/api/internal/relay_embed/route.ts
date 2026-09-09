import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedPendingSegments } from "@/server/services/transcript_service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/relay_embed
 *
 * Background embedding for transcript segments — cron-triggered.
 *
 * Deliberately not done inline at ingest. Transcript ingest sits on the hot
 * path of an agent hook, and a hook must never wait on a third-party API. So
 * segments become searchable by keyword the instant they land, and gain vector
 * search when this catches up. A deployment with no `EMBEDDING_API_KEY` never
 * runs this at all and still has working search.
 *
 * Authenticated with `EMBED_CRON_TOKEN`, the same secret the notes embedding
 * cron uses.
 *
 * Wire via Vercel Cron:
 *
 *   { "path": "/api/internal/relay_embed", "schedule": "5,15,25,35,45,55 * * * *" }
 *
 * Response: `{ ok, embedded, skipped }`.
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

  // Constant-time compare, and a length check first because timingSafeEqual
  // throws on a length mismatch.
  const presentedBuf = Buffer.from(presented);
  const secretBuf = Buffer.from(secret);
  const authorized =
    presentedBuf.length === secretBuf.length &&
    timingSafeEqual(presentedBuf, secretBuf);

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);

  try {
    const admin = createAdminClient();
    const result = await embedPendingSegments(admin, {
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "Relay embedding backfill failed");
    return NextResponse.json(
      { ok: false, error: "Embedding backfill failed" },
      { status: 500 }
    );
  }
}
