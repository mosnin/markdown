import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/internal/partition_maintenance
 *
 * Authenticated via the `PARTITION_MAINTENANCE_TOKEN` env var (shared
 * secret). Callers pass the token in the `Authorization: Bearer <token>`
 * header.
 *
 * Calls the `create_future_audit_partitions` database function to ensure
 * monthly partitions exist for the audit_events table.
 *
 * Response shape: `{ ok, created }`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.PARTITION_MAINTENANCE_TOKEN;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "PARTITION_MAINTENANCE_TOKEN not configured" },
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
  const { data, error } = await admin.rpc("create_future_audit_partitions", {
    months_ahead: 3,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    created: data ?? [],
  });
}
