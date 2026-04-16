import { type NextRequest, NextResponse } from "next/server";
import {
  resolveMcpRequestAuth,
  requireScope,
  requireWrite,
  requireNoBranchTargeting,
  toConnectionRequestContext,
  BranchTargetingNotAllowedError,
} from "@/server/auth/mcp_auth_adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createProposal,
  listProposalsForConnection,
} from "@/server/services/write_proposal_service";
import { auditMcp } from "@/server/services/audit_service";
import {
  apiOk,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
  E_RATE_LIMITED,
  E_INSUFFICIENT_SCOPE,
  E_FORBIDDEN_ROLE,
  E_BRANCH_TARGETING_NOT_ALLOWED,
} from "@/lib/api/response";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";
import { type ProposalStatus } from "@/server/domain/constants/audit_constants";
import { apiWriteLimit } from "@/lib/api/rate_limit";

// ── Proposal type sets ────────────────────────────────────────────────────────
const NOTE_PROPOSAL_TYPES = new Set([
  "create_note",
  "update_note",
  "append_note",
  "replace_note",
]);
const OBJECT_PROPOSAL_TYPES = new Set([
  "update_file",
  "create_skill",
  "update_skill",
  "create_agent",
  "update_agent",
]);
const VALID_PROPOSAL_TYPES = [
  ...NOTE_PROPOSAL_TYPES,
  ...OBJECT_PROPOSAL_TYPES,
];
const VALID_STATUSES = ["pending", "approved", "rejected", "conflicted", "canceled", "expired"];
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
// Content/field size guards — prevents excessively large payloads reaching the DB
const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 500_000; // ~500 KB of markdown
const MAX_SUMMARY_LENGTH = 2000;
const MAX_RATIONALE_LENGTH = 2000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 100;

/**
 * POST /api/v1/write_proposals
 *
 * Create a write proposal for a note or an object (file / skill /
 * agent).
 *
 * Auth: OAuth access token with `context:propose` scope and a non-
 * viewer workspace role. Legacy csk_v1_ tokens are accepted when the
 * env flag is on (scope gate short-circuits), and fall through to the
 * permission_mode check in the underlying service.
 *
 * Branch targeting: OAuth-backed writes target main only. Requests
 * carrying a `branch_id` field are rejected with 400.
 *
 * Rate-limited: 20 requests per minute per authenticated
 * connection/token via the in-process limiter.
 */

export async function POST(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:propose")) {
    return E_INSUFFICIENT_SCOPE("context:propose");
  }
  if (!requireWrite(ctx)) {
    return E_FORBIDDEN_ROLE("Viewer role cannot submit write proposals");
  }

  // Rate limit per connection/token (20 writes/min)
  const rl = apiWriteLimit(ctx.connectionId);
  if (!rl.allowed) return E_RATE_LIMITED(rl.retryAfter);

  // permission_mode check — still honoured for legacy csk_v1_ contexts.
  // OAuth-synthesized permission_mode is derived from the scopes above
  // so this branch is effectively a no-op for OAuth, but we keep the
  // check because the underlying service expects it.
  if (
    ctx.permissionMode !== PERMISSION_MODE.PROPOSE_WRITES &&
    ctx.permissionMode !== PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS
  ) {
    return E_FORBIDDEN(
      "Connection must have propose_writes or generate_in_allowed_folders permission"
    );
  }

  // Defense-in-depth 1MB payload cap. Next.js enforces its own cap at
  // parse time, but an explicit Content-Length check gives clients a
  // clear 413 before the body is buffered and makes the limit a
  // deliberate, reviewable policy rather than an implicit framework
  // default.
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json(
      { error: "payload_too_large" },
      { status: 413 }
    );
  }

  let body: {
    proposal_type?: string;
    target_note_id?: string;
    target_folder_id?: string;
    target_object_id?: string;
    proposed_title?: string;
    proposed_content?: string;
    proposed_summary?: string;
    proposed_tags?: string[];
    rationale?: string;
    branch_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return E_BAD_REQUEST("Request body must be valid JSON");
  }

  // Explicit branch rejection for OAuth-backed writes. Write proposals
  // do not currently accept a branch_id in their service signature —
  // this is defense in depth in case a client sends one.
  try {
    requireNoBranchTargeting(ctx, body.branch_id ?? null);
  } catch (err) {
    if (err instanceof BranchTargetingNotAllowedError) {
      return E_BRANCH_TARGETING_NOT_ALLOWED();
    }
    throw err;
  }

  const { proposal_type } = body;
  if (!proposal_type) return E_BAD_REQUEST("proposal_type is required");
  if (!VALID_PROPOSAL_TYPES.includes(proposal_type)) {
    return E_BAD_REQUEST(
      `proposal_type must be one of: ${VALID_PROPOSAL_TYPES.join(", ")}`
    );
  }

  // Field size validation
  if (body.proposed_title && body.proposed_title.length > MAX_TITLE_LENGTH) {
    return E_BAD_REQUEST(`proposed_title must not exceed ${MAX_TITLE_LENGTH} characters`);
  }
  if (body.proposed_content && body.proposed_content.length > MAX_CONTENT_LENGTH) {
    return E_BAD_REQUEST(`proposed_content must not exceed ${MAX_CONTENT_LENGTH} characters`);
  }
  if (body.proposed_summary && body.proposed_summary.length > MAX_SUMMARY_LENGTH) {
    return E_BAD_REQUEST(`proposed_summary must not exceed ${MAX_SUMMARY_LENGTH} characters`);
  }
  if (body.rationale && body.rationale.length > MAX_RATIONALE_LENGTH) {
    return E_BAD_REQUEST(`rationale must not exceed ${MAX_RATIONALE_LENGTH} characters`);
  }
  if (Array.isArray(body.proposed_tags)) {
    if (!body.proposed_tags.every((t) => typeof t === "string")) {
      return E_BAD_REQUEST("proposed_tags must be an array of strings");
    }
    if (body.proposed_tags.length > MAX_TAGS) {
      return E_BAD_REQUEST(`proposed_tags must not exceed ${MAX_TAGS} tags`);
    }
    if (body.proposed_tags.some((t) => t.length > MAX_TAG_LENGTH)) {
      return E_BAD_REQUEST(`Each tag must not exceed ${MAX_TAG_LENGTH} characters`);
    }
  }

  const adminClient = createAdminClient();
  const sharedFields = {
    proposed_title: body.proposed_title ?? null,
    proposed_content: body.proposed_content ?? null,
    proposed_summary: body.proposed_summary ?? null,
    proposed_tags: Array.isArray(body.proposed_tags) ? body.proposed_tags : null,
    rationale: body.rationale ?? null,
  };

  // Build a ConnectionRequestContext-shaped bridge so the existing
  // write_proposal_service code path keeps working unchanged. This
  // service never bypasses the trust-gating helpers — it re-checks
  // permission_mode + box scope internally.
  const bridge = toConnectionRequestContext(ctx);

  try {
    const proposal = await createProposal(
      adminClient,
      bridge,
      OBJECT_PROPOSAL_TYPES.has(proposal_type)
        ? {
            proposal_type: proposal_type as
              | "update_file"
              | "create_skill"
              | "update_skill"
              | "create_agent"
              | "update_agent",
            target_object_id: body.target_object_id ?? null,
            ...sharedFields,
          }
        : {
            proposal_type: proposal_type as
              | "create_note"
              | "update_note"
              | "append_note"
              | "replace_note",
            target_note_id: body.target_note_id ?? null,
            target_folder_id: body.target_folder_id ?? null,
            ...sharedFields,
          }
    );

    // Audit the user-attributed MCP event alongside the
    // connection-attributed event the service wrote. For OAuth this
    // names the user as the actor; for legacy csk_v1_ we skip (no user).
    if (ctx.source === "oauth" && ctx.userId) {
      auditMcp(adminClient, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        clientId: ctx.clientId,
        connectionId: ctx.connectionId,
        source: ctx.source,
        objectType: "write_proposal",
        objectId: proposal.id,
        eventType: `mcp.write_proposal.created`,
        metadata: { proposal_type },
      });
    }

    return apiOk(proposal, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) {
      return E_NOT_FOUND("The requested resource was not found");
    }
    if (
      msg.includes("permission") ||
      msg.includes("not in an allowed box") ||
      msg.includes("allowed")
    ) {
      return E_FORBIDDEN("Connection does not have access to this resource");
    }
    if (
      msg.includes("required") ||
      msg.includes("Unknown proposal_type") ||
      msg.includes("target_object_id") ||
      msg.includes("trashed")
    ) {
      return E_BAD_REQUEST(msg);
    }
    console.error("[write_proposals] Unexpected error:", err);
    return E_INTERNAL();
  }
}

/**
 * GET /api/v1/write_proposals
 *
 * List write proposals created by this connection/token.
 *
 * Auth: OAuth access token with `context:propose` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await resolveMcpRequestAuth(request);
  if (!ctx) return E_UNAUTHORIZED();
  if (!requireScope(ctx, "context:propose")) {
    return E_INSUFFICIENT_SCOPE("context:propose");
  }

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
    const bridge = toConnectionRequestContext(ctx);
    const proposals = await listProposalsForConnection(adminClient, bridge, {
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
