import { type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  apiOk,
  apiError,
  E_NOT_FOUND,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import {
  parseOperatorBearer,
  verifyApiKey,
} from "@/server/services/operator_api_keys_service";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";
import { isWorkspaceOperatorEnabled } from "@/lib/env";
import { withApiHandler } from "@/server/api/with_api_handler";

/**
 * GET /api/operator/runs/[id]
 *
 * Returns a single Operator run row, scoped to the workspace the
 * `wopr_` API key was minted against. A run that exists but lives in
 * a different workspace is surfaced as 404 rather than 403 so the
 * endpoint never reveals which other workspaces a key holder might
 * see (information disclosure defence).
 *
 * Authorization: same `Authorization: Bearer wopr_<key>` scheme as
 * the POST route.
 */

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<Record<string, string>>;
}

export const GET = withApiHandler(async (request: NextRequest, { params }: RouteParams) => {
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
  // Reject malformed ids before the DB call so a caller who fuzzes the
  // route gets a clean 404 instead of a Postgres type-cast 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return E_NOT_FOUND("run not found");
  }

  const supabase = createAdminClient();
  const run = await getOperatorRun(supabase, id);

  // Cross-workspace runs return 404 (not 403) by design — see route doc.
  if (!run || run.workspace_id !== verified.workspaceId) {
    return E_NOT_FOUND("run not found");
  }

  return apiOk({
    run_id: run.id,
    workspace_id: run.workspace_id,
    user_id: run.user_id,
    branch_id: run.branch_id,
    prompt: run.prompt,
    mode: run.mode,
    status: run.status,
    plan: run.plan,
    result: run.result,
    error: run.error,
    notes_created: run.notes_created,
    tool_calls: run.tool_calls,
    duration_ms: run.duration_ms,
    input_tokens: run.input_tokens,
    output_tokens: run.output_tokens,
    cached_input_tokens: run.cached_input_tokens,
    model: run.model,
    created_at: run.created_at,
    updated_at: run.updated_at,
  });
});
