import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  autoDiscardExpiredBranches,
  warnStaleBranches,
} from "@/server/services/branch_lifecycle_service";

export const runtime = "nodejs";

/**
 * POST /api/internal/branch_cleanup
 *
 * Authenticated via the platform-level `BRANCH_CLEANUP_CRON_TOKEN` env
 * var. Callers pass the token in the `Authorization: Bearer <token>`
 * header. No workspace scoping — the endpoint iterates every workspace
 * with a `workspace_branch_retention_policies` row where `enabled =
 * true` and runs the warn + auto-discard loops against each.
 *
 * Wire via Vercel Cron:
 *
 *   // vercel.json
 *   {
 *     "crons": [
 *       { "path": "/api/internal/branch_cleanup", "schedule": "0 * * * *" }
 *     ]
 *   }
 *
 * Or any external cron that can POST with the bearer token set in the
 * env var. The endpoint is idempotent — warn cooldown and
 * warning-gated auto-discard keep repeated calls from over-acting.
 *
 * Response shape: `{ ok, workspaces, warned, discarded }`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.BRANCH_CLEANUP_CRON_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "BRANCH_CLEANUP_CRON_TOKEN not configured" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!presented || presented !== secret) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const admin = createAdminClient();
  const { data: policies } = await admin
    .from("workspace_branch_retention_policies")
    .select("workspace_id")
    .eq("enabled", true);

  let totalWarned = 0;
  let totalDiscarded = 0;
  const workspaces = (policies ?? []).length;

  for (const row of policies ?? []) {
    try {
      const warned = await warnStaleBranches(admin, row.workspace_id as string);
      totalWarned += warned;
    } catch {
      // per-workspace failure shouldn't stop the cron loop
    }
    try {
      const discarded = await autoDiscardExpiredBranches(
        admin,
        row.workspace_id as string
      );
      totalDiscarded += discarded;
    } catch {
      // per-workspace failure shouldn't stop the cron loop
    }
  }

  return NextResponse.json({
    ok: true,
    workspaces,
    warned: totalWarned,
    discarded: totalDiscarded,
  });
}
