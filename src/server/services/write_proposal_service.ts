import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import { type WriteProposal } from "@/server/domain/types/write_proposal";
import { type ConnectionRequestContext } from "@/server/auth/get_connection_context";
import { PROPOSAL_TYPE, PROPOSAL_STATUS } from "@/server/domain/constants/audit_constants";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";
import {
  getWriteProposalById,
  listWriteProposalsByWorkspace,
  listWriteProposalsByConnection,
  createWriteProposal,
  updateWriteProposal,
  type CreateWriteProposalInput,
} from "@/server/repositories/write_proposal_repository";
import { getNoteById } from "@/server/repositories/note_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import {
  auditWriteProposalCreated,
  auditWriteProposalApproved,
  auditWriteProposalRejected,
  auditWriteProposalConflicted,
} from "@/server/services/audit_service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateProposalInput {
  proposal_type: "create_note" | "update_note" | "append_note" | "replace_note";
  /** Required for create_note. */
  target_folder_id?: string | null;
  /** Required for update_note / append_note / replace_note. */
  target_note_id?: string | null;
  proposed_title?: string | null;
  proposed_content?: string | null;
  proposed_summary?: string | null;
  proposed_tags?: string[] | null;
  rationale?: string | null;
}

export interface ApproveOutcome {
  outcome: "approved" | "conflicted";
  reason?: string;
  note?: Note;
}

export interface ProposalWithPreview {
  proposal: WriteProposal;
  /** Pre-merged content for append_note; proposed_content for others. */
  preview_content: string | null;
  /** Current note snapshot for update/append/replace review. */
  current_note: Note | null;
}

// ─── Permission check ─────────────────────────────────────────────────────────

function canPropose(permissionMode: string): boolean {
  return (
    permissionMode === PERMISSION_MODE.PROPOSE_WRITES ||
    permissionMode === PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS
  );
}

// ─── Create proposal ──────────────────────────────────────────────────────────

/**
 * Creates a write proposal from an authenticated connection.
 *
 * Enforces:
 * - permission_mode must be propose_writes or generate_in_allowed_folders
 * - for update/append/replace: target note must be in an allowed box
 * - for create_note: target folder must be in an allowed box
 * - target_version_id is captured at submission time (current note version)
 */
export async function createProposal(
  adminClient: SupabaseClient,
  ctx: ConnectionRequestContext,
  input: CreateProposalInput
): Promise<WriteProposal> {
  if (!canPropose(ctx.connection.permission_mode)) {
    throw new Error("Connection does not have write proposal permission");
  }

  const { proposal_type } = input;
  let target_note_id: string | null = null;
  let target_version_id: string | null = null;
  let target_folder_id: string | null = null;
  let auditBoxId: string | null = null;
  let auditFolderId: string | null = null;

  if (
    proposal_type === PROPOSAL_TYPE.UPDATE_NOTE ||
    proposal_type === PROPOSAL_TYPE.APPEND_NOTE ||
    proposal_type === PROPOSAL_TYPE.REPLACE_NOTE
  ) {
    if (!input.target_note_id) {
      throw new Error("target_note_id is required for update_note, append_note, replace_note proposals");
    }

    const note = await getNoteById(adminClient, input.target_note_id);
    if (!note || note.status === "trashed") {
      throw new Error("Target note not found");
    }
    if (!ctx.allowedBoxIds.has(note.box_id)) {
      throw new Error("Target note is not in an allowed box");
    }

    target_note_id = note.id;
    target_version_id = note.current_version_id;
    auditBoxId = note.box_id;
  } else if (proposal_type === PROPOSAL_TYPE.CREATE_NOTE) {
    if (!input.target_folder_id) {
      throw new Error("target_folder_id is required for create_note proposals");
    }

    const folder = await getFolderById(adminClient, input.target_folder_id);
    if (!folder || folder.status === "trashed") {
      throw new Error("Target folder not found");
    }
    if (!ctx.allowedBoxIds.has(folder.box_id)) {
      throw new Error("Target folder is not in an allowed box");
    }

    target_folder_id = folder.id;
    auditBoxId = folder.box_id;
    auditFolderId = folder.id;
  } else {
    throw new Error(`Unknown proposal_type: ${proposal_type}`);
  }

  const createInput: CreateWriteProposalInput = {
    workspace_id: ctx.workspaceId,
    connection_id: ctx.connection.id,
    proposal_type,
    target_note_id,
    target_version_id,
    proposed_title: input.proposed_title ?? null,
    proposed_content: input.proposed_content ?? null,
    proposed_summary: input.proposed_summary ?? null,
    proposed_tags: input.proposed_tags ?? null,
    proposed_folder_id: target_folder_id,
    rationale: input.rationale ?? null,
  };

  const proposal = await createWriteProposal(adminClient, createInput);

  auditWriteProposalCreated(adminClient, ctx.workspaceId, ctx.connection.id, proposal.id, {
    proposal_type,
    target_note_id,
    target_folder_id: auditFolderId,
    box_id: auditBoxId,
  });

  return proposal;
}

// ─── List proposals (human app) ───────────────────────────────────────────────

export async function listProposalsForWorkspace(
  adminClient: SupabaseClient,
  workspaceId: string,
  opts: {
    status?: WriteProposal["status"];
    connection_id?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WriteProposal[]> {
  return listWriteProposalsByWorkspace(adminClient, workspaceId, opts);
}

// ─── List proposals (connection API) ─────────────────────────────────────────

export async function listProposalsForConnection(
  adminClient: SupabaseClient,
  ctx: ConnectionRequestContext,
  opts: {
    status?: WriteProposal["status"];
    limit?: number;
    offset?: number;
  } = {}
): Promise<WriteProposal[]> {
  return listWriteProposalsByConnection(
    adminClient,
    ctx.connection.id,
    ctx.workspaceId,
    opts
  );
}

// ─── Approve ──────────────────────────────────────────────────────────────────

/**
 * Approves a pending proposal.
 * Calls the appropriate atomic SQL function based on proposal_type.
 * Never mutates the note directly — relies on the SQL function for atomicity.
 */
export async function approveProposal(
  adminClient: SupabaseClient,
  userId: string,
  workspaceId: string,
  proposalId: string,
  reviewNote?: string | null
): Promise<ApproveOutcome> {
  const proposal = await getWriteProposalById(adminClient, proposalId);
  if (!proposal || proposal.workspace_id !== workspaceId) {
    throw new Error("Proposal not found");
  }
  if (proposal.status !== PROPOSAL_STATUS.PENDING) {
    throw new Error(`Proposal is not pending (status: ${proposal.status})`);
  }

  if (proposal.proposal_type === PROPOSAL_TYPE.CREATE_NOTE) {
    return _approveCreate(adminClient, userId, workspaceId, proposal, reviewNote ?? null);
  } else {
    return _approveUpdate(adminClient, userId, workspaceId, proposal, reviewNote ?? null);
  }
}

async function _approveUpdate(
  adminClient: SupabaseClient,
  userId: string,
  workspaceId: string,
  proposal: WriteProposal,
  reviewNote: string | null
): Promise<ApproveOutcome> {
  const { data, error } = await adminClient.rpc("approve_write_proposal_update", {
    p_proposal_id: proposal.id,
    p_reviewer_id: userId,
    p_review_note: reviewNote,
  });

  if (error) throw new Error(error.message);

  const result = data as { outcome: string; note?: Note; reason?: string };

  if (result.outcome === "approved") {
    auditWriteProposalApproved(adminClient, workspaceId, userId, proposal.id, {
      proposal_type: proposal.proposal_type,
      connection_id: proposal.connection_id,
      note_id: proposal.target_note_id,
    });
    return { outcome: "approved", note: result.note };
  } else {
    auditWriteProposalConflicted(adminClient, workspaceId, userId, proposal.id, {
      proposal_type: proposal.proposal_type,
      connection_id: proposal.connection_id,
      reason: result.reason ?? "Version conflict",
    });
    return { outcome: "conflicted", reason: result.reason };
  }
}

async function _approveCreate(
  adminClient: SupabaseClient,
  userId: string,
  workspaceId: string,
  proposal: WriteProposal,
  reviewNote: string | null
): Promise<ApproveOutcome> {
  // Pre-compute unique slug / path_cache in the service layer
  const { slug, pathCache } = await _uniqueSlugForProposal(adminClient, proposal);

  const { data, error } = await adminClient.rpc("approve_write_proposal_create", {
    p_proposal_id: proposal.id,
    p_reviewer_id: userId,
    p_slug: slug,
    p_path_cache: pathCache,
    p_review_note: reviewNote,
  });

  if (error) throw new Error(error.message);

  const result = data as { outcome: string; note?: Note; reason?: string };

  if (result.outcome === "approved") {
    auditWriteProposalApproved(adminClient, workspaceId, userId, proposal.id, {
      proposal_type: proposal.proposal_type,
      connection_id: proposal.connection_id,
      note_id: result.note?.id ?? null,
    });
    return { outcome: "approved", note: result.note };
  } else {
    auditWriteProposalConflicted(adminClient, workspaceId, userId, proposal.id, {
      proposal_type: proposal.proposal_type,
      connection_id: proposal.connection_id,
      reason: result.reason ?? "Conflict",
    });
    return { outcome: "conflicted", reason: result.reason };
  }
}

/** Compute unique slug/path_cache for a create_note proposal before calling the RPC. */
async function _uniqueSlugForProposal(
  adminClient: SupabaseClient,
  proposal: WriteProposal
): Promise<{ slug: string; pathCache: string }> {
  const folder = await getFolderById(adminClient, proposal.proposed_folder_id!);
  if (!folder) throw new Error("Target folder not found");

  const title = proposal.proposed_title ?? "Untitled";
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  let pathCache = `${folder.path_cache}/${slug}`;

  while (await _notePathExists(adminClient, folder.box_id, pathCache)) {
    slug = `${base}-${suffix++}`;
    pathCache = `${folder.path_cache}/${slug}`;
  }

  return { slug, pathCache };
}

async function _notePathExists(
  adminClient: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await adminClient
    .from("notes")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", "trashed")
    .maybeSingle();
  return !!data;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
}

// ─── Reject ───────────────────────────────────────────────────────────────────

/**
 * Rejects a pending proposal. No note mutation occurs.
 */
export async function rejectProposal(
  adminClient: SupabaseClient,
  userId: string,
  workspaceId: string,
  proposalId: string,
  reviewNote?: string | null
): Promise<WriteProposal> {
  const proposal = await getWriteProposalById(adminClient, proposalId);
  if (!proposal || proposal.workspace_id !== workspaceId) {
    throw new Error("Proposal not found");
  }
  if (proposal.status !== PROPOSAL_STATUS.PENDING) {
    throw new Error(`Proposal is not pending (status: ${proposal.status})`);
  }

  const updated = await updateWriteProposal(adminClient, proposalId, {
    status: PROPOSAL_STATUS.REJECTED,
    reviewer_id: userId,
    reviewed_at: new Date().toISOString(),
    review_note: reviewNote ?? null,
  });

  if (!updated) throw new Error("Failed to reject proposal");

  auditWriteProposalRejected(adminClient, workspaceId, userId, proposalId, {
    proposal_type: proposal.proposal_type,
    connection_id: proposal.connection_id,
  });

  return updated;
}

// ─── Preview ──────────────────────────────────────────────────────────────────

/**
 * Assembles a preview for human review:
 * - current_note: the live note (for update/append/replace)
 * - preview_content: what the note would look like after approval
 */
export async function buildProposalPreview(
  adminClient: SupabaseClient,
  proposal: WriteProposal
): Promise<ProposalWithPreview> {
  let current_note: Note | null = null;
  let preview_content: string | null = null;

  if (proposal.target_note_id) {
    current_note = await getNoteById(adminClient, proposal.target_note_id);
  }

  switch (proposal.proposal_type) {
    case PROPOSAL_TYPE.CREATE_NOTE:
      preview_content = proposal.proposed_content;
      break;

    case PROPOSAL_TYPE.UPDATE_NOTE:
    case PROPOSAL_TYPE.REPLACE_NOTE:
      preview_content = proposal.proposed_content;
      break;

    case PROPOSAL_TYPE.APPEND_NOTE:
      if (current_note) {
        const existing = current_note.markdown_content ?? "";
        const appended = proposal.proposed_content ?? "";
        preview_content = appended ? `${existing}\n\n${appended}` : existing;
      } else {
        preview_content = proposal.proposed_content;
      }
      break;

    default:
      preview_content = proposal.proposed_content;
  }

  return { proposal, preview_content, current_note };
}

// ─── Get with context ─────────────────────────────────────────────────────────

/**
 * Fetches a proposal with its preview context.
 * Verifies workspace ownership.
 */
export async function getProposalWithPreview(
  adminClient: SupabaseClient,
  proposalId: string,
  workspaceId: string
): Promise<ProposalWithPreview | null> {
  const proposal = await getWriteProposalById(adminClient, proposalId);
  if (!proposal || proposal.workspace_id !== workspaceId) return null;
  return buildProposalPreview(adminClient, proposal);
}

// ─── Stale check ─────────────────────────────────────────────────────────────

/**
 * Marks a proposal conflicted if the target note's current_version_id no
 * longer matches proposal.target_version_id.
 *
 * Safe to call speculatively (e.g. when loading the review UI).
 * Returns updated proposal if status changed; otherwise original.
 */
export async function checkAndMarkConflicted(
  adminClient: SupabaseClient,
  proposal: WriteProposal
): Promise<WriteProposal> {
  if (proposal.status !== PROPOSAL_STATUS.PENDING) return proposal;
  if (!proposal.target_note_id || !proposal.target_version_id) return proposal;

  const note = await getNoteById(adminClient, proposal.target_note_id);
  if (!note) return proposal;

  if (note.current_version_id !== proposal.target_version_id) {
    const updated = await updateWriteProposal(adminClient, proposal.id, {
      status: PROPOSAL_STATUS.CONFLICTED,
    });
    return updated ?? proposal;
  }

  return proposal;
}

// ─── Re-export for convenience ────────────────────────────────────────────────

export type { WriteProposal };
export { getBoxById };
