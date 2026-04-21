import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  apiOk,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_UNAUTHORIZED,
} from "@/lib/api/response";
import { listPendingForWorkspace } from "@/server/services/tool_call_approvals_service";

/**
 * GET /api/agent/operator/approvals?workspace_id=...
 *
 * Workspace-level inbox of pending tool-call approvals across all runs.
 * RLS scopes the query to workspaces the caller can see, so an
 * unauthorized workspace_id simply returns an empty list.
 */

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return E_UNAUTHORIZED("Valid session required.");
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id");
  if (!workspaceId) {
    return E_BAD_REQUEST("workspace_id query parameter is required.");
  }
  if (!UUID_RE.test(workspaceId)) {
    return E_BAD_REQUEST("workspace_id must be a valid UUID.");
  }

  try {
    const approvals = await listPendingForWorkspace(supabase, workspaceId, 50);
    return apiOk({ approvals });
  } catch (err) {
    console.error("[agent operator workspace approvals GET] failed", {
      workspace_id: workspaceId,
      err: err instanceof Error ? err.message : String(err),
    });
    return E_INTERNAL("Failed to list pending approvals.");
  }
}
