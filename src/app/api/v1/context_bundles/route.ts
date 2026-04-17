import { type NextRequest } from "next/server";
import { resolveMcpRequestAuth, requireScope } from "@/server/auth/mcp_auth_adapter";
import { canAccessBox } from "@/server/services/oauth_scope_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById } from "@/server/repositories/note_repository";
import { assembleContextBundle } from "@/server/services/context_bundle_service";
import { auditMcp, auditBundleReadByConnection } from "@/server/services/audit_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_INSUFFICIENT_SCOPE,
} from "@/lib/api/response";

/**
 * POST /api/v1/context_bundles
 *
 * Assembles a bounded, deterministic context bundle centered on a
 * note.
 *
 * Auth: OAuth access token with `context:bundles` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:bundles")) {
    return E_INSUFFICIENT_SCOPE("context:bundles");
  }

  let body: {
    note_id?: string;
    include_guide?: boolean;
    include_ancestor_summary?: boolean;
    include_archived?: boolean;
    linked_limit?: number;
    include_user_branches?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { note_id } = body;
  if (!note_id) return E_BAD_REQUEST("note_id is required");

  const adminClient = createAdminClient();

  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND("Note not found");
  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();
  if (ctx.source === "oauth" && !canAccessBox(ctx.scopes, note.box_id)) {
    return E_FORBIDDEN();
  }

  // Branch overlay is scoped to the authenticated user's own
  // branches. Legacy csk_v1_ tokens don't have a user identity, so
  // the overlay is silently inert there — the flag requires an
  // OAuth-resolved userId.
  const includeUserBranches = body.include_user_branches === true;
  const overlayUserId =
    includeUserBranches && ctx.source === "oauth" && ctx.userId
      ? ctx.userId
      : undefined;

  try {
    const bundle = await assembleContextBundle(
      adminClient,
      ctx.workspaceId,
      note_id,
      {
        includeGuide: body.include_guide ?? true,
        includeAncestorSummary: body.include_ancestor_summary ?? true,
        includeArchived: body.include_archived ?? false,
        linkedLimit: body.linked_limit ?? 10,
        includeUserBranches: overlayUserId !== undefined,
        userId: overlayUserId,
      }
    );

    // Audit the bundle read. For OAuth contexts we use the unified
    // auditMcp writer so the human user is named as the actor and the
    // oauth client id ends up in metadata. Legacy csk_v1_ contexts
    // retain the classic connection-actor shape.
    if (ctx.source === "oauth" && ctx.userId) {
      auditMcp(adminClient, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        clientId: ctx.clientId,
        connectionId: ctx.connectionId,
        source: ctx.source,
        objectType: "note",
        objectId: note_id,
        eventType: "bundle.read",
        metadata: {
          box_id: bundle.box.id,
          linked_count: bundle.linked_notes.length,
          guide_included: bundle.guide_note !== null,
          ancestor_summary_included: bundle.ancestor_summary_note !== null,
          truncated: bundle.truncated,
          include_user_branches: includeUserBranches,
          pending_branch_count: bundle.pending_branch_changes?.length ?? 0,
        },
      });
    } else {
      auditBundleReadByConnection(adminClient, ctx.workspaceId, ctx.connectionId, note_id, {
        box_id: bundle.box.id,
        linked_count: bundle.linked_notes.length,
        guide_included: bundle.guide_note !== null,
        ancestor_summary_included: bundle.ancestor_summary_note !== null,
        truncated: bundle.truncated,
      });
    }

    return apiOk(bundle);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Assembly failed";
    if (msg === "Note not found" || msg === "Not found") return E_NOT_FOUND(msg);
    return E_INTERNAL();
  }
}
