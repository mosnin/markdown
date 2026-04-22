import { NextResponse } from "next/server";
import { startKgBackfillAction } from "@/app/app/settings/knowledge_graph_actions";

export const runtime = "nodejs";

/**
 * POST /api/internal/kg/backfill
 *
 * Wraps the `startKgBackfillAction` server action so the backfill can be
 * triggered from a CLI or cron job. Authentication is handled inside the
 * server action via `requireAuthenticatedUser` (session cookie).
 */
export async function POST() {
  const result = await startKgBackfillAction();
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
