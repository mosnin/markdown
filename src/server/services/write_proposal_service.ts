import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import { type WriteProposal } from "@/server/domain/types/write_proposal";
import { type ConnectionRequestContext } from "@/server/auth/get_connection_context";
import {
  PROPOSAL_TYPE,
  PROPOSAL_STATUS,
  NOTE_PROPOSAL_TYPES,
  OBJECT_PROPOSAL_TYPES,
} from "@/server/domain/constants/audit_constants";
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

export interface CreateNoteProposalInput {
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

export interface CreateObjectProposalInput {
  proposal_type: "update_file" | "create_skill" | "update_skill" | "create_agent" | "update_agent";
  /**
   * For update_* proposals: the id of the target file/skill/agent.
   * For create_* proposals: not required (target_object_id is null until approved).
   */
  target_object_id?: string | null;
  proposed_title?: string | null;
  proposed_content?: string | null;
  proposed_summary?: string | null;
  proposed_tags?: string[] | null;
  rationale?: string | null;
}

/** Unified input type for the public API. */
export type CreateProposalInput = CreateNoteProposalInput | CreateObjectProposalInput;

export interface ApproveOutcome {
  outcome: "approved" | "conflicted";
  reason?: string;
  note?: Note;
  object_id?: string;
  version_id?: string;
}

export interface ProposalWithPreview {
  proposal: WriteProposal;
  /** Pre-merged content for append_note; proposed_content for others. */
  preview_content: string | null;
  /** Current note snapshot for update/append/replace note review. */
  current_note: Note | null;
  /** Current object snapshot for file/skill/agent review. */
  current_object: CurrentObjectSnapshot | null;
}

export interface CurrentObjectSnapshot {
  id: string;
  object_type: "file" | "skill" | "agent";
  name: string;
  source_content: string;
  canonical_format: string;
  current_version_id: string | null;
  is_reusable?: boolean;
}

// ─── Permission check ─────────────────────────────────────────────────────────

function canPropose(permissionMode: string): boolean {
  return (
    permissionMode === PERMISSION_MODE.PROPOSE_WRITES ||
    permissionMode === PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS
  );
}

// ─── Object ownership helper ──────────────────────────────────────────────────

/**
 * Fetch a file/skill/agent row and verify it belongs to the workspace.
 * Reusable skills/agents (is_reusable=true) have no box_id — they are
 * workspace-level objects and allowed regardless of allowedBoxIds.
 *
 * Box-local objects must be in an allowed box.
 */
async function resolveObjectWithPermission(
  adminClient: SupabaseClient,
  ctx: ConnectionRequestContext,
  objectType: "file" | "skill" | "agent",
  objectId: string
): Promise<{
  id: string;
  name: string;
  source_content: string;
  canonical_format: string;
  current_version_id: string | null;
  status: string;
  box_id: string | null;
  is_reusable: boolean;
}> {
  const table = objectType === "file" ? "files" : objectType === "skill" ? "skills" : "agents";

  const { data, error } = await adminClient
    .from(table)
    .select("id, name, source_content, canonical_format, current_version_id, status, box_id, is_reusable, workspace_id")
    .eq("id", objectId)
    .single();

  if (error || !data) throw new Error(`Target ${objectType} not found`);
  if ((data as { workspace_id: string }).workspace_id !== ctx.workspaceId) {
    throw new Error(`Target ${objectType} not found`);
  }
  if ((data as { status: string }).status === "trashed") {
    throw new Error(`Target ${objectType} is trashed`);
  }

  const row = data as {
    id: string;
    name: string;
    source_content: string;
    canonical_format: string;
    current_version_id: string | null;
    status: string;
    box_id: string | null;
    is_reusable: boolean;
    workspace_id: string;
  };

  // Reusable workspace objects are allowed regardless of box scope.
  // Box-local objects must be in an allowed box.
  if (!row.is_reusable) {
    if (!row.box_id || !ctx.allowedBoxIds.has(row.box_id)) {
      throw new Error(`Target ${objectType} is not in an allowed box`);
    }
  }

  return {
    id: row.id,
    name: row.name,
    source_content: row.source_content,
    canonical_format: row.canonical_format,
    current_version_id: row.current_version_id,
    status: row.status,
    box_id: row.box_id,
    is_reusable: row.is_reusable,
  };
}

// ─── Create proposal ──────────────────────────────────────────────────────────

/**
 * Creates a write proposal from an authenticated connection.
 *
 * Note proposals:
 *   - permission_mode must be propose_writes or generate_in_allowed_folders
 *   - for update/append/replace: target note must be in an allowed box
 *   - for create_note: target folder must be in an allowed box
 *   - target_version_id is captured at submission time
 *
 * Object proposals (file/skill/agent):
 *   - same permission requirements
 *   - reusable skills/agents (is_reusable=true) are always allowed by scope
 *   - box-local objects must be in an allowed box
 *   - target_object_version_id is captured at submission time
 *   - reusable shared skills/agents: proposal-only (no direct generation)
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

  // ── Note proposals ────────────────────────────────────────────────────────

  if (NOTE_PROPOSAL_TYPES.has(proposal_type as (typeof PROPOSAL_TYPE)[keyof typeof PROPOSAL_TYPE])) {
    return _createNoteProposal(adminClient, ctx, input as CreateNoteProposalInput);
  }

  // ── Object proposals ──────────────────────────────────────────────────────

  if (OBJECT_PROPOSAL_TYPES.has(proposal_type as (typeof PROPOSAL_TYPE)[keyof typeof PROPOSAL_TYPE])) {
    return _createObjectProposal(adminClient, ctx, input as CreateObjectProposalInput);
  }

  throw new Error(`Unknown proposal_type: ${proposal_type}`);
}

async function _createNoteProposal(
  adminClient: SupabaseClient,
  ctx: ConnectionRequestContext,
  input: CreateNoteProposalInput
): Promise<WriteProposal> {
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
    throw new Error(`Unknown note proposal_type: ${proposal_type}`);
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

async function _createObjectProposal(
  adminClient: SupabaseClient,
  ctx: ConnectionRequestContext,
  input: CreateObjectProposalInput
): Promise<WriteProposal> {
  const { proposal_type } = input;

  const objectType =
    proposal_type === PROPOSAL_TYPE.UPDATE_FILE
      ? "file"
      : proposal_type === PROPOSAL_TYPE.CREATE_SKILL || proposal_type === PROPOSAL_TYPE.UPDATE_SKILL
      ? "skill"
      : "agent";

  const isUpdate =
    proposal_type === PROPOSAL_TYPE.UPDATE_FILE ||
    proposal_type === PROPOSAL_TYPE.UPDATE_SKILL ||
    proposal_type === PROPOSAL_TYPE.UPDATE_AGENT;

  let target_object_id: string | null = null;
  let target_object_version_id: string | null = null;
  let auditBoxId: string | null = null;

  if (isUpdate) {
    if (!input.target_object_id) {
      throw new Error(`target_object_id is required for ${proposal_type} proposals`);
    }

    const obj = await resolveObjectWithPermission(
      adminClient, ctx, objectType, input.target_object_id
    );

    target_object_id = obj.id;
    target_object_version_id = obj.current_version_id;
    auditBoxId = obj.box_id;
  }
  // create_skill / create_agent: no target object yet; will be created on approval
  // These are workspace-level only; they require that the connection is allowed to
  // write to the workspace (which canPropose already enforces above).

  const createInput: CreateWriteProposalInput = {
    workspace_id: ctx.workspaceId,
    connection_id: ctx.connection.id,
    proposal_type,
    target_object_type: objectType,
    target_object_id,
    target_object_version_id,
    proposed_title: input.proposed_title ?? null,
    proposed_content: input.proposed_content ?? null,
    proposed_summary: input.proposed_summary ?? null,
    proposed_tags: input.proposed_tags ?? null,
    rationale: input.rationale ?? null,
  };

  const proposal = await createWriteProposal(adminClient, createInput);

  auditWriteProposalCreated(adminClient, ctx.workspaceId, ctx.connection.id, proposal.id, {
    proposal_type,
    target_object_type: objectType,
    target_object_id,
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
 * Routes to the appropriate approval path based on proposal_type.
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
  }

  if (NOTE_PROPOSAL_TYPES.has(proposal.proposal_type)) {
    return _approveUpdate(adminClient, userId, workspaceId, proposal, reviewNote ?? null);
  }

  if (
    proposal.proposal_type === PROPOSAL_TYPE.UPDATE_FILE ||
    proposal.proposal_type === PROPOSAL_TYPE.UPDATE_SKILL ||
    proposal.proposal_type === PROPOSAL_TYPE.UPDATE_AGENT
  ) {
    return _approveObjectUpdate(adminClient, userId, workspaceId, proposal, reviewNote ?? null);
  }

  if (
    proposal.proposal_type === PROPOSAL_TYPE.CREATE_SKILL ||
    proposal.proposal_type === PROPOSAL_TYPE.CREATE_AGENT
  ) {
    return _approveObjectCreate(adminClient, userId, workspaceId, proposal, reviewNote ?? null);
  }

  throw new Error(`Unsupported proposal_type for approval: ${proposal.proposal_type}`);
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

async function _approveObjectUpdate(
  adminClient: SupabaseClient,
  userId: string,
  workspaceId: string,
  proposal: WriteProposal,
  reviewNote: string | null
): Promise<ApproveOutcome> {
  const { data, error } = await adminClient.rpc("approve_write_proposal_object_update", {
    p_proposal_id: proposal.id,
    p_reviewer_id: userId,
    p_review_note: reviewNote,
  });

  if (error) throw new Error(error.message);

  const result = data as {
    outcome: string;
    object_id?: string;
    version_id?: string;
    reason?: string;
  };

  if (result.outcome === "approved") {
    auditWriteProposalApproved(adminClient, workspaceId, userId, proposal.id, {
      proposal_type: proposal.proposal_type,
      connection_id: proposal.connection_id,
      object_type: proposal.target_object_type,
      object_id: proposal.target_object_id,
      version_id: result.version_id,
    });
    return {
      outcome: "approved",
      object_id: result.object_id,
      version_id: result.version_id,
    };
  } else {
    auditWriteProposalConflicted(adminClient, workspaceId, userId, proposal.id, {
      proposal_type: proposal.proposal_type,
      connection_id: proposal.connection_id,
      reason: result.reason ?? "Version conflict",
    });
    return { outcome: "conflicted", reason: result.reason };
  }
}

async function _approveObjectCreate(
  adminClient: SupabaseClient,
  userId: string,
  workspaceId: string,
  proposal: WriteProposal,
  reviewNote: string | null
): Promise<ApproveOutcome> {
  // create_skill / create_agent: create the object then set approved_version_id
  const objectType = proposal.target_object_type!; // 'skill' or 'agent'
  const title = proposal.proposed_title ?? "Untitled";
  const slug = slugify(title);
  const content = proposal.proposed_content ?? "";

  // Insert the object row
  const objectRow = {
    workspace_id: workspaceId,
    name: title,
    slug,
    path_cache: slug,
    source_content: content,
    content_bytes: Buffer.from(content, "utf-8").length,
    canonical_format: "markdown",
    description: proposal.proposed_summary ?? null,
    tags: proposal.proposed_tags ?? [],
    is_reusable: true,
    status: "active",
    origin_type: "generated",
  };

  const table = objectType === "skill" ? "skills" : "agents";
  const { data: newObj, error: insertErr } = await adminClient
    .from(table)
    .insert(objectRow)
    .select("id")
    .single();

  if (insertErr || !newObj) {
    throw new Error(insertErr?.message ?? `Failed to create ${objectType}`);
  }

  const objectId = (newObj as { id: string }).id;

  // Create initial version
  const { data: versionId, error: versionErr } = await adminClient.rpc(
    "create_object_with_initial_version",
    {
      p_object_type: objectType,
      p_object_id: objectId,
      p_workspace_id: workspaceId,
      p_actor_id: userId,
      p_source_content: content,
      p_actor_type: "user",
      p_change_origin: "proposal_approved",
    }
  );

  if (versionErr) throw new Error(versionErr.message);

  // Mark proposal approved
  await updateWriteProposal(adminClient, proposal.id, {
    status: PROPOSAL_STATUS.APPROVED,
    reviewer_id: userId,
    reviewed_at: new Date().toISOString(),
    review_note: reviewNote,
    approved_version_id: versionId as string,
  });

  auditWriteProposalApproved(adminClient, workspaceId, userId, proposal.id, {
    proposal_type: proposal.proposal_type,
    connection_id: proposal.connection_id,
    object_type: objectType,
    object_id: objectId,
    version_id: versionId as string,
  });

  return {
    outcome: "approved",
    object_id: objectId,
    version_id: versionId as string,
  };
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
 * Rejects a pending proposal. No object mutation occurs.
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
 * Assembles a preview for human review.
 * For note proposals: current_note + merged preview_content.
 * For object proposals: current_object snapshot + proposed_content.
 */
export async function buildProposalPreview(
  adminClient: SupabaseClient,
  proposal: WriteProposal
): Promise<ProposalWithPreview> {
  let current_note: Note | null = null;
  let current_object: CurrentObjectSnapshot | null = null;
  let preview_content: string | null = null;

  if (NOTE_PROPOSAL_TYPES.has(proposal.proposal_type)) {
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
  } else if (OBJECT_PROPOSAL_TYPES.has(proposal.proposal_type)) {
    if (proposal.target_object_id && proposal.target_object_type) {
      const table =
        proposal.target_object_type === "file"
          ? "files"
          : proposal.target_object_type === "skill"
          ? "skills"
          : "agents";

      const { data } = await adminClient
        .from(table)
        .select("id, name, source_content, canonical_format, current_version_id, is_reusable")
        .eq("id", proposal.target_object_id)
        .single();

      if (data) {
        const row = data as {
          id: string;
          name: string;
          source_content: string;
          canonical_format: string;
          current_version_id: string | null;
          is_reusable: boolean;
        };
        current_object = {
          id: row.id,
          object_type: proposal.target_object_type,
          name: row.name,
          source_content: row.source_content,
          canonical_format: row.canonical_format,
          current_version_id: row.current_version_id,
          is_reusable: row.is_reusable,
        };
      }
    }
    // Object proposals are always full-content replacement
    preview_content = proposal.proposed_content;
  }

  return { proposal, preview_content, current_note, current_object };
}

// ─── Get with context ─────────────────────────────────────────────────────────

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
 * Marks a proposal conflicted if the target's current version no longer
 * matches the version captured at submission time.
 *
 * Works for both note proposals (target_version_id) and object proposals
 * (target_object_version_id).
 *
 * Safe to call speculatively when loading the review UI.
 */
export async function checkAndMarkConflicted(
  adminClient: SupabaseClient,
  proposal: WriteProposal
): Promise<WriteProposal> {
  if (proposal.status !== PROPOSAL_STATUS.PENDING) return proposal;

  // Note conflict check
  if (proposal.target_note_id && proposal.target_version_id) {
    const note = await getNoteById(adminClient, proposal.target_note_id);
    if (!note) return proposal;

    if (note.current_version_id !== proposal.target_version_id) {
      const updated = await updateWriteProposal(adminClient, proposal.id, {
        status: PROPOSAL_STATUS.CONFLICTED,
      });
      return updated ?? proposal;
    }
  }

  // Object conflict check
  if (proposal.target_object_id && proposal.target_object_type && proposal.target_object_version_id) {
    const table =
      proposal.target_object_type === "file"
        ? "files"
        : proposal.target_object_type === "skill"
        ? "skills"
        : "agents";

    const { data } = await adminClient
      .from(table)
      .select("current_version_id")
      .eq("id", proposal.target_object_id)
      .single();

    if (
      data &&
      (data as { current_version_id: string | null }).current_version_id !==
        proposal.target_object_version_id
    ) {
      const updated = await updateWriteProposal(adminClient, proposal.id, {
        status: PROPOSAL_STATUS.CONFLICTED,
      });
      return updated ?? proposal;
    }
  }

  return proposal;
}

// ─── Re-export for convenience ────────────────────────────────────────────────

export type { WriteProposal };
export { getBoxById };
