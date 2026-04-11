import { type SupabaseClient } from "@supabase/supabase-js";
import { type WriteProposal } from "@/server/domain/types/write_proposal";
import {
  type ProposalType,
  type ProposalStatus,
  PROPOSAL_STATUS,
} from "@/server/domain/constants/audit_constants";

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

  if (error || !data) throw new Error(error?.message ?? "Failed to create write proposal");
  return data as WriteProposal;
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
