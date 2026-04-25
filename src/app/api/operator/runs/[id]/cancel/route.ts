import { type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_INTERNAL,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  parseOperatorBearer,
  verifyApiKey,
} from "@/server/services/operator_api_keys_service";
import {
  getOperatorRun,
  updateOperatorRun,
} from "@/server/services/workspace_operator_runs_service";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * POST /api/operator/runs/[id]/cancel
 *
 * External cancel surface — closes the Workspace Operator "API clients
 * cannot cancel" gap. The cookie-session UI flips
 * `cancellation_requested_at` via `cancelRunAction`; this route mirrors
 * that DB write for `wopr_` bearer callers. The Modal Python operator
 * polls `/api/agent/operator/check_cancel` between phases and aborts
 * once the column flips, so this is the same physical mechanism — the
 * REST surface just exposes it to automation / CI.
 *
 * Authorization: same `Authorization: Bearer wopr_<key>` scheme as the
 * POST / GET operator routes. Cross-workspace runs return 404 (not 403)
 * to match the information-disclosure stance of the GET route.
 *
 * Idempotency: terminal runs (completed / failed / cancelled) return 200
 * with `already_cancelled: true` and do NOT write. Active runs flip the
 * timestamp and return 200 with `already_cancelled: false`. Re-POSTing
 * against a run that already has `cancellation_requested_at` set is a
 * no-op that returns `already_cancelled: true` — we treat "cancel was
 * already requested" identically to "terminal" for the REST contract.
 */

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<Record<string, string>>;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export const POST = withApiHandler(async (request: NextRequest, { params }: RouteParams) => {
  if (!isWorkspaceOperatorEnabled()) {
    return apiError(
      "operator_disabled",
      "Workspace Operator is not enabled for this deployment.",
      503
    );
  }

  const bearer = parseOperatorBearer(request.headers.get("authorization"));
  if (!bearer) {
    return E_UNAUTHORIZED("Authorization: Bearer wopr_<key> header required.");
  }

  const verified = await verifyApiKey(bearer);
  if (!verified) {
    return E_UNAUTHORIZED("Invalid or revoked API key.");
  }

  const { id } = await params;
  if (!id) return E_NOT_FOUND("run id required");
  // Reject malformed ids before the DB call — a fuzzed id otherwise
  // bubbles up as a Postgres type-cast 500. Mirrors the GET [id] route.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return E_NOT_FOUND("run not found");
  }

  const supabase = createAdminClient();

  try {
    const run = await getOperatorRun(supabase, id);
    // Cross-workspace runs return 404 (not 403) by design — never leak
    // which other workspaces a key holder might see.
    if (!run || run.workspace_id !== verified.workspaceId) {
      return E_NOT_FOUND("run not found");
    }

    // Terminal runs: idempotent no-op, no DB write. The Python operator
    // either already stopped, or the run never got off the ground.
    if (TERMINAL_STATUSES.has(run.status)) {
      return apiOk({
        run_id: run.id,
        cancelled: true,
        already_cancelled: true,
        status: run.status,
      });
    }

    // Already-requested cancellations: also a no-op. We don't refresh
    // the timestamp because downstream observers treat the first flip
    // as authoritative.
    if (run.cancellation_requested_at) {
      return apiOk({
        run_id: run.id,
        cancelled: true,
        already_cancelled: true,
        status: run.status,
      });
    }

    // Active run — flip the column. We intentionally do NOT advance
    // `status` here; the Python operator is responsible for writing
    // `status="cancelled"` once it actually stops. This matches the
    // semantics of `cancelOperatorRun` in the service layer.
    await updateOperatorRun(supabase, id, {
      cancellationRequestedAt: new Date().toISOString(),
    });

    return apiOk({
      run_id: run.id,
      cancelled: true,
      already_cancelled: false,
      status: "cancel_requested",
    });
  } catch (err) {
    console.error("[operator REST cancel] failed", {
      run_id: id,
      workspace_id: verified.workspaceId,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to cancel run.");
  }
});
