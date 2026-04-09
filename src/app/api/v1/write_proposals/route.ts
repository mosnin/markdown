import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createProposal,
  listProposalsForConnection,
} from "@/server/services/write_proposal_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";
import { type ProposalStatus } from "@/server/domain/constants/audit_constants";

const VALID_PROPOSAL_TYPES = ["create_note", "update_note", "append_note", "replace_note"];
const VALID_STATUSES = ["pending", "approved", "rejected", "conflicted", "canceled", "expired"];
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// ─── POST /api/v1/write_proposals ────────────────────────────────────────────
//
// Create a write proposal.
//
// Request body:
//   {
//     proposal_type: "create_note" | "update_note" | "append_note" | "replace_note",
//     target_note_id?:   string,  // required for update_note / append_note / replace_note
//     target_folder_id?: string,  // required for create_note
//     proposed_title?:   string,
//     proposed_content?: string,
//     proposed_summary?: string,
//     proposed_tags?:    string[],
//     rationale?:        string,
//   }
//
// Permission: propose_writes OR generate_in_allowed_folders
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  if (
    ctx.connection.permission_mode !== PERMISSION_MODE.PROPOSE_WRITES &&
    ctx.connection.permission_mode !== PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS
  ) {
    return E_FORBIDDEN(
      "Connection must have propose_writes or generate_in_allowed_folders permission"
    );
  }

  let body: {
    proposal_type?: string;
    target_note_id?: string;
    target_folder_id?: string;
    proposed_title?: string;
    proposed_content?: string;
    proposed_summary?: string;
    proposed_tags?: string[];
    rationale?: string;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  const { proposal_type } = body;
  if (!proposal_type) return E_BAD_REQUEST("proposal_type is required");
  if (!VALID_PROPOSAL_TYPES.includes(proposal_type)) {
    return E_BAD_REQUEST(
      `proposal_type must be one of: ${VALID_PROPOSAL_TYPES.join(", ")}`
    );
  }

  if (Array.isArray(body.proposed_tags)) {
    if (!body.proposed_tags.every((t) => typeof t === "string")) {
      return E_BAD_REQUEST("proposed_tags must be an array of strings");
    }
  }

  const adminClient = createAdminClient();

  try {
    const proposal = await createProposal(adminClient, ctx, {
      proposal_type: proposal_type as
        | "create_note"
        | "update_note"
        | "append_note"
        | "replace_note",
      target_note_id: body.target_note_id ?? null,
      target_folder_id: body.target_folder_id ?? null,
      proposed_title: body.proposed_title ?? null,
      proposed_content: body.proposed_content ?? null,
      proposed_summary: body.proposed_summary ?? null,
      proposed_tags: Array.isArray(body.proposed_tags) ? body.proposed_tags : null,
      rationale: body.rationale ?? null,
    });

    return apiOk(proposal, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found") || msg === "Target note not found") {
      return E_NOT_FOUND(msg);
    }
    if (
      msg.includes("permission") ||
      msg.includes("not in an allowed box")
    ) {
      return E_FORBIDDEN(msg);
    }
    if (
      msg.includes("required") ||
      msg.includes("Unknown proposal_type")
    ) {
      return E_BAD_REQUEST(msg);
    }
    return E_INTERNAL();
  }
}

// ─── GET /api/v1/write_proposals ─────────────────────────────────────────────
//
// List write proposals created by this connection.
//
// Query parameters:
//   status?  — filter by status
//   limit?   — default 50, max 100
//   page?    — 1-based page number (default 1)
//
// Permission: any non-read_only connection (but only sees its own proposals)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const searchParams = request.nextUrl.searchParams;
  const statusParam = searchParams.get("status");
  const limitParam = searchParams.get("limit");
  const pageParam = searchParams.get("page");

  const limit = Math.min(
    Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const offset = (page - 1) * limit;

  let status: ProposalStatus | undefined;
  if (statusParam) {
    if (!VALID_STATUSES.includes(statusParam)) {
      return E_BAD_REQUEST(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    status = statusParam as ProposalStatus;
  }

  const adminClient = createAdminClient();

  try {
    const proposals = await listProposalsForConnection(adminClient, ctx, {
      status,
      limit,
      offset,
    });

    return apiOk({
      proposals,
      pagination: { page, limit, count: proposals.length },
    });
  } catch {
    return E_INTERNAL();
  }
}
