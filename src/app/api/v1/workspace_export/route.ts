import { type NextRequest } from "next/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createClient } from "@/lib/supabase/server";
import { canAdmin } from "@/server/auth/require_role";
import { exportWorkspace } from "@/server/services/workspace_export_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_INTERNAL,
} from "@/lib/api/response";

/**
 * GET /api/v1/workspace_export
 *
 * Exports the caller's active workspace as a JSON document.
 * Admin-only — requires an authenticated session with admin or owner role.
 *
 * Returns a WorkspaceExport JSON body with Content-Disposition header
 * for browser download.
 */
export async function GET(_request: NextRequest) {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    return E_UNAUTHORIZED("Unauthorized — valid session required");
  }

  if (!canAdmin(ctx.workspace.role)) {
    return E_FORBIDDEN("Admin access required for workspace export");
  }

  const supabase = await createClient();

  try {
    const exportData = await exportWorkspace(supabase, ctx.workspace.id);
    const json = JSON.stringify(exportData, null, 2);
    const filename = `${ctx.workspace.slug}-export-${new Date().toISOString().slice(0, 10)}.json`;

    return new Response(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return E_INTERNAL(message);
  }
}
