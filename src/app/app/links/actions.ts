"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { createLink, updateLink, deleteLink } from "@/server/services/link_service";
import { type RelationshipType } from "@/server/domain/constants/note_constants";
import { type ActionResult } from "@/app/app/boxes/actions";

export type { ActionResult };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return { supabase, userId: ctx.user.id, workspaceId: ctx.workspace.id };
}

// ─── Link actions ─────────────────────────────────────────────────────────────

export async function createLinkAction(
  sourceNoteId: string,
  targetNoteId: string,
  relationshipType: RelationshipType,
  relationshipNote?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const link = await createLink(supabase, userId, workspaceId, {
      sourceNoteId,
      targetNoteId,
      relationshipType,
      relationshipNote: relationshipNote ?? null,
    });
    return { ok: true, data: { id: link.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create link",
    };
  }
}

export async function updateLinkAction(
  linkId: string,
  newRelationshipType?: RelationshipType,
  newRelationshipNote?: string | null
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const link = await updateLink(
      supabase,
      userId,
      workspaceId,
      linkId,
      {
        newRelationshipType,
        newRelationshipNote,
      }
    );
    return { ok: true, data: { id: link.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update link",
    };
  }
}

export async function deleteLinkAction(
  linkId: string
): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await deleteLink(supabase, userId, workspaceId, linkId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete link",
    };
  }
}
