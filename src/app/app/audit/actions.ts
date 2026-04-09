"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listWorkspaceAuditEvents } from "@/server/services/audit_view_service";
import { type ActorType } from "@/server/domain/constants/audit_constants";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

interface FetchAuditEventsInput {
  workspaceId: string;
  actor_type?: ActorType;
  object_type?: string;
  event_type?: string;
  page?: number;
  limit?: number;
}

/** Fetch workspace audit events with optional filters. Used by AuditPanel client component. */
export async function fetchAuditEventsAction(
  input: FetchAuditEventsInput
): Promise<ActionResult<Awaited<ReturnType<typeof listWorkspaceAuditEvents>>>> {
  try {
    const ctx = await requireAuthenticatedUser();

    // Verify the workspace belongs to the authenticated user
    if (input.workspaceId !== ctx.workspace.id) {
      return { success: false, error: "Not found" };
    }

    const supabase = await createClient();
    const result = await listWorkspaceAuditEvents(supabase, ctx.workspace.id, {
      actor_type: input.actor_type,
      object_type: input.object_type,
      event_type: input.event_type,
      page: input.page,
      limit: input.limit ?? 50,
    });

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
