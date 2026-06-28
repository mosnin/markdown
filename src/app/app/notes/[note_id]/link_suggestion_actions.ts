"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { suggestLinks } from "@/server/services/link_suggestion_service";
import { createLink } from "@/server/services/link_service";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";
import { type RelationshipType } from "@/server/domain/constants/note_constants";
import { log } from "@/lib/logger";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LinkSuggestionRow {
  id: string;
  note_id: string;
  target_note_id: string;
  suggested_relationship: string;
  confidence: number;
  reason: string | null;
  status: string;
  target_note_title?: string;
}

// ─── Generate suggestions ───────────────────────────────────────────────────

/**
 * Calls the LLM to suggest related notes and upserts them into the
 * link_suggestions table. Returns the pending suggestions.
 */
export async function generateLinkSuggestionsAction(
  noteId: string
): Promise<ActionResult<LinkSuggestionRow[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const suggestions = await suggestLinks(
      supabase,
      noteId,
      ctx.workspace.id,
      ctx.user.id
    );

    if (suggestions.length === 0) {
      return { success: true, data: [] };
    }

    // Upsert each suggestion into the link_suggestions table
    const adminClient = createAdminClient();
    const rows: LinkSuggestionRow[] = [];

    for (const s of suggestions) {
      const { data, error } = await adminClient
        .from("link_suggestions")
        .upsert(
          {
            note_id: noteId,
            workspace_id: ctx.workspace.id,
            target_note_id: s.targetNoteId,
            suggested_relationship: s.suggestedRelationship,
            confidence: s.confidence,
            reason: s.reason,
            status: "pending",
          },
          { onConflict: "note_id,target_note_id" }
        )
        .select()
        .single();

      if (error) {
        log.warn("link_suggestion_upsert_error", {
          note_id: noteId,
          target_note_id: s.targetNoteId,
          error: error.message,
        });
        continue;
      }

      if (data) {
        rows.push({
          ...(data as LinkSuggestionRow),
          target_note_title: s.targetNoteTitle,
        });
      }
    }

    return { success: true, data: rows };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate suggestions";
    log.error("generate_link_suggestions_failed", {
      note_id: noteId,
      reason: message,
    });
    return { success: false, error: message };
  }
}

// ─── Accept suggestion ──────────────────────────────────────────────────────

/**
 * Accept a suggestion: create the actual note_link, mark the suggestion
 * as accepted.
 */
export async function acceptLinkSuggestionAction(
  suggestionId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const adminClient = createAdminClient();

    // Fetch the suggestion
    const { data: suggestion, error: fetchErr } = await adminClient
      .from("link_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .eq("workspace_id", ctx.workspace.id)
      .single();

    if (fetchErr || !suggestion) {
      return { success: false, error: "Suggestion not found" };
    }

    if (suggestion.status !== "pending") {
      return {
        success: false,
        error: `Suggestion already ${suggestion.status}`,
      };
    }

    // Create the actual note link
    await createLink(supabase, ctx.user.id, ctx.workspace.id, {
      sourceNoteId: suggestion.note_id,
      targetNoteId: suggestion.target_note_id,
      relationshipType: suggestion.suggested_relationship as RelationshipType,
      relationshipNote: suggestion.reason ?? null,
    });

    // Mark the suggestion as accepted
    const { error: updateErr } = await adminClient
      .from("link_suggestions")
      .update({ status: "accepted" })
      .eq("id", suggestionId)
      .eq("workspace_id", ctx.workspace.id);

    if (updateErr) {
      log.warn("link_suggestion_accept_update_error", {
        suggestion_id: suggestionId,
        error: updateErr.message,
      });
    }

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "link_suggestion",
      object_id: suggestionId,
      event_type: "link.suggestion.accepted",
      metadata: {
        note_id: suggestion.note_id,
        target_note_id: suggestion.target_note_id,
      },
    });

    revalidatePath(`/app/notes/${suggestion.note_id}`);
    return { success: true, data: undefined };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to accept suggestion";
    log.error("accept_link_suggestion_failed", {
      suggestion_id: suggestionId,
      reason: message,
    });
    return { success: false, error: message };
  }
}

// ─── Dismiss suggestion ─────────────────────────────────────────────────────

/**
 * Dismiss a suggestion — marks it as dismissed so it won't appear again.
 */
export async function dismissLinkSuggestionAction(
  suggestionId: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const adminClient = createAdminClient();

    // Fetch the suggestion (scoped to the caller's workspace) — this gets
    // note_id for revalidation AND confirms the suggestion belongs to the
    // caller before we mutate it.
    const { data: suggestion } = await adminClient
      .from("link_suggestions")
      .select("note_id, target_note_id")
      .eq("id", suggestionId)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle();

    if (!suggestion) {
      return { success: false, error: "Suggestion not found" };
    }

    const { error } = await adminClient
      .from("link_suggestions")
      .update({ status: "dismissed" })
      .eq("id", suggestionId)
      .eq("workspace_id", ctx.workspace.id);

    if (error) {
      return { success: false, error: error.message };
    }

    await createAuditEvent(supabase, {
      workspace_id: ctx.workspace.id,
      actor_type: "user",
      actor_id: ctx.user.id,
      object_type: "link_suggestion",
      object_id: suggestionId,
      event_type: "link.suggestion.dismissed",
      metadata: {
        note_id: suggestion.note_id,
        target_note_id: suggestion.target_note_id,
      },
    });

    if (suggestion.note_id) {
      revalidatePath(`/app/notes/${suggestion.note_id}`);
    }

    return { success: true, data: undefined };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to dismiss suggestion";
    log.error("dismiss_link_suggestion_failed", {
      suggestion_id: suggestionId,
      reason: message,
    });
    return { success: false, error: message };
  }
}

// ─── Fetch pending suggestions ──────────────────────────────────────────────

/**
 * Fetch existing pending suggestions for a note. Used by the UI to
 * display previously generated suggestions.
 */
export async function fetchPendingSuggestionsAction(
  noteId: string
): Promise<ActionResult<LinkSuggestionRow[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from("link_suggestions")
      .select("*")
      .eq("note_id", noteId)
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "pending")
      .order("confidence", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data ?? []) as LinkSuggestionRow[] };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch suggestions";
    return { success: false, error: message };
  }
}
