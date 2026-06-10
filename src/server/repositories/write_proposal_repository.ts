import { type SupabaseClient } from "@supabase/supabase-js";
import { type WriteProposal } from "@/server/domain/types/write_proposal";
import {
  type ProposalType,
  type ProposalStatus,
  PROPOSAL_STATUS,
} from "@/server/domain/constants/audit_constants";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Write proposal repository.
 *
 * Design notes:
 * - Proposals are created by connections and reviewed by workspace owners.
 * - Only status transitions are allowed after creation (no content edits).
 * - approved_note_id and approved_version_id are populated by the service
 *   when a 'create_note' or object approval is processed.
 * - target_object_type / target_object_id / target_object_version_id are
 *   set for file/skill/agent proposals; they are null for note proposals.
 */

export interface CreateWriteProposalInput {
  workspace_id: string;
  connection_id: string;
  proposal_type: ProposalType;
  // Note targets
  target_note_id?: string | null;
  target_version_id?: string | null;
  proposed_folder_id?: string | null;
  // Object targets (file / skill / agent)
  target_object_type?: "file" | "skill" | "agent" | null;
  target_object_id?: string | null;
  target_object_version_id?: string | null;
  // Proposal content
  proposed_title?: string | null;
  proposed_content?: string | null;
  proposed_summary?: string | null;
  proposed_tags?: string[] | null;
  rationale?: string | null;
  expires_at?: string | null;
}

export interface UpdateWriteProposalInput {
  status?: ProposalStatus;
  reviewer_id?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  approved_note_id?: string | null;
  approved_version_id?: string | null;
}

export async function getWriteProposalById(
  supabase: SupabaseClient,
  id: string
): Promise<WriteProposal | null> {
  const { data, error } = await supabase
    .from("write_proposals")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as WriteProposal;
}

export async function listWriteProposalsByWorkspace(
  supabase: SupabaseClient,
  workspace_id: string,
  {
    status,
    connection_id,
    target_object_type,
    limit = 50,
    offset = 0,
  }: {
    status?: ProposalStatus;
    connection_id?: string;
    target_object_type?: "file" | "skill" | "agent" | null;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WriteProposal[]> {
  let query = supabase
    .from("write_proposals")
    .select("*")
    .eq("workspace_id", workspace_id);

  if (status) query = query.eq("status", status);
  if (connection_id) query = query.eq("connection_id", connection_id);
  if (target_object_type !== undefined) {
    if (target_object_type === null) {
      query = query.is("target_object_type", null);
    } else {
      query = query.eq("target_object_type", target_object_type);
    }
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return data as WriteProposal[];
}

/** Pending proposals that have not yet expired. */
export async function listPendingProposals(
  supabase: SupabaseClient,
  workspace_id: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<WriteProposal[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("write_proposals")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("status", PROPOSAL_STATUS.PENDING)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return data as WriteProposal[];
}

/**
 * List pending proposals targeting a specific object (file/skill/agent).
 * Used to show pending proposal badges on object detail pages.
 */
export async function listPendingProposalsForObject(
  supabase: SupabaseClient,
  workspace_id: string,
  object_type: "file" | "skill" | "agent",
  object_id: string
): Promise<WriteProposal[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("write_proposals")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("status", PROPOSAL_STATUS.PENDING)
    .eq("target_object_type", object_type)
    .eq("target_object_id", object_id)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as WriteProposal[];
}

/**
 * List pending proposals targeting a specific note.
 * Used to show pending proposal badges on note detail pages.
 */
export async function listPendingProposalsForNote(
  supabase: SupabaseClient,
  workspace_id: string,
  note_id: string
): Promise<WriteProposal[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("write_proposals")
    .select("*")
    .eq("workspace_id", workspace_id)
    .eq("status", PROPOSAL_STATUS.PENDING)
    .eq("target_note_id", note_id)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as WriteProposal[];
}

/**
 * List proposals created by a specific connection.
 * Used by the external API (connection can only see its own proposals).
 */
export async function listWriteProposalsByConnection(
  supabase: SupabaseClient,
  connection_id: string,
  workspace_id: string,
  {
    status,
    limit = 50,
    offset = 0,
  }: {
    status?: ProposalStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WriteProposal[]> {
  let query = supabase
    .from("write_proposals")
    .select("*")
    .eq("connection_id", connection_id)
    .eq("workspace_id", workspace_id);

  if (status) query = query.eq("status", status);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];
  return data as WriteProposal[];
}

export async function createWriteProposal(
  supabase: SupabaseClient,
  input: CreateWriteProposalInput
): Promise<WriteProposal> {
  const { data, error } = await supabase
    .from("write_proposals")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new RepositoryError("createWriteProposal", error);
  return data as WriteProposal;
}

/**
 * Signal returned by {@link createWriteProposalGuarded} when the per-period
 * paywall cap was hit. Mirrors the jsonb the `create_write_proposal_guarded`
 * RPC emits; the service maps it to a typed `QuotaExceededResult`.
 */
export interface GuardedQuotaExceeded {
  quota_exceeded: true;
  limit: number;
  used: number;
}

export function isGuardedQuotaExceeded(
  value: unknown
): value is GuardedQuotaExceeded {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { quota_exceeded?: unknown }).quota_exceeded === true
  );
}

/**
 * Atomic, quota-gated proposal insert.
 *
 * Closes the check-then-insert TOCTOU on the write-proposal paywall: the
 * `create_write_proposal_guarded` RPC takes a per-workspace transaction
 * advisory lock, counts period usage, and inserts ONLY when under `limit` —
 * all in one transaction, so N concurrent writers serialize and the cap holds
 * exactly. When `limit` is null the gate is disabled and the insert always
 * proceeds.
 *
 * Returns the created {@link WriteProposal} (same full-row shape as
 * {@link createWriteProposal}) or a {@link GuardedQuotaExceeded} signal when
 * the workspace is at/over its cap (nothing inserted). Infra errors throw,
 * matching the existing repository contract.
 */
export async function createWriteProposalGuarded(
  supabase: SupabaseClient,
  input: CreateWriteProposalInput,
  quota: { limit: number | null; periodStart: Date }
): Promise<WriteProposal | GuardedQuotaExceeded> {
  const { workspace_id, ...proposalFields } = input;

  const { data, error } = await supabase.rpc("create_write_proposal_guarded", {
    p_workspace_id: workspace_id,
    p_proposal: proposalFields,
    p_quota_limit: quota.limit,
    p_period_start: quota.periodStart.toISOString(),
  });

  if (error || !data) throw new RepositoryError("createWriteProposalGuarded", error);

  if (isGuardedQuotaExceeded(data)) return data;

  const row = (data as { proposal?: unknown }).proposal;
  if (!row) throw new RepositoryError("createWriteProposalGuarded", error);
  return row as WriteProposal;
}

export async function updateWriteProposal(
  supabase: SupabaseClient,
  id: string,
  input: UpdateWriteProposalInput
): Promise<WriteProposal | null> {
  const { data, error } = await supabase
    .from("write_proposals")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as WriteProposal;
}
