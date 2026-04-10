"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  approveProposal,
  rejectProposal,
} from "@/server/services/write_proposal_service";
import { setGeneratedFolderPolicy } from "@/server/services/folder_service";
import { log } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionResult =
  | { success: true; data?: unknown }
  | { success: false; error: string };

// ─── Approve proposal ─────────────────────────────────────────────────────────

export async function approveProposalAction(
  proposalId: string,
  reviewNote?: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const adminClient = createAdminClient();

    const outcome = await approveProposal(
      adminClient,
      ctx.user!.id,
      ctx.workspace.id,
      proposalId,
      reviewNote ?? null
    );

    return { success: true, data: outcome };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    log.error("proposal_approve_failed", { proposal_id: proposalId, reason });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to approve proposal",
    };
  }
}

// ─── Reject proposal ──────────────────────────────────────────────────────────

export async function rejectProposalAction(
  proposalId: string,
  reviewNote?: string
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const adminClient = createAdminClient();

    const proposal = await rejectProposal(
      adminClient,
      ctx.user!.id,
      ctx.workspace.id,
      proposalId,
      reviewNote ?? null
    );

    return { success: true, data: proposal };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    log.error("proposal_reject_failed", { proposal_id: proposalId, reason });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reject proposal",
    };
  }
}

// ─── Set generated folder policy ─────────────────────────────────────────────

export async function setFolderGeneratedPolicyAction(
  folderId: string,
  accepts: boolean
): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedUser();
    const adminClient = createAdminClient();

    const folder = await setGeneratedFolderPolicy(
      adminClient,
      ctx.user!.id,
      ctx.workspace.id,
      folderId,
      accepts
    );

    return { success: true, data: { id: folder.id, accepts_generated_notes: folder.accepts_generated_notes } };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update folder policy",
    };
  }
}
