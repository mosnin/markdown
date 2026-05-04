import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  redeemPullToken,
  lookupPullTokenIdByString,
} from "@/server/services/pull_token_service";
import {
  auditBundlePulled,
  auditBundlePulledInvalid,
} from "@/server/services/audit_service";
import { createProposal } from "@/server/services/write_proposal_service";
import {
  PERMISSION_MODE,
  CONNECTION_STATUS,
  CONNECTION_TYPE,
} from "@/server/domain/constants/connection_constants";
import { type ConnectionRequestContext } from "@/server/auth/get_connection_context";
import { type Connection } from "@/server/domain/types/connection";

/**
 * POST `/p/n/[token]/propose` — write-proposal redemption.
 *
 * The agent calls this with a JSON body shaped:
 *
 *   { kind: "create_note", payload: { folder_id, title, content, ... } }
 *   { kind: "update_note", payload: { content, title?, summary?, tags? } }
 *   { kind: "append_to_note", payload: { content } }
 *
 * The route redeems the token, verifies write_capable, then delegates
 * to `write_proposal_service.createProposal` with a synthetic
 * `ConnectionRequestContext` derived from a per-workspace "pull_token"
 * service connection. The proposal lands in the existing review queue
 * with attribution back to the issuing user via audit metadata.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token: rawToken } = await params;
  const userAgent = request.headers.get("user-agent");
  const admin = createAdminClient();

  // ── Redeem the token (atomic) ───────────────────────────────────────────
  const result = await redeemPullToken(admin, rawToken, userAgent);
  if (!result) {
    auditBundlePulledInvalid(admin, null, {
      token_prefix: rawToken.slice(0, 16),
      user_agent: userAgent,
      reason: "expired_or_unknown",
    });
    return Response.json({ error: "expired" }, { status: 401 });
  }

  if (!result.writeCapable) {
    return Response.json({ error: "read-only token" }, { status: 403 });
  }

  if (result.objectType !== "note") {
    return Response.json(
      { error: "object_type not yet supported by pull-token write-proposals" },
      { status: 415 }
    );
  }

  // ── Parse + validate body ───────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const { kind, payload } = body as {
    kind?: unknown;
    payload?: unknown;
  };
  if (
    kind !== "create_note" &&
    kind !== "update_note" &&
    kind !== "append_to_note"
  ) {
    return Response.json({ error: "invalid_kind" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "missing_payload" }, { status: 400 });
  }

  // ── Map to write_proposal_service input ─────────────────────────────────
  const proposalInput = mapKindToProposalInput(
    kind,
    payload as Record<string, unknown>,
    result.objectId
  );
  if ("error" in proposalInput) {
    return Response.json({ error: proposalInput.error }, { status: 400 });
  }

  // ── Build a synthetic connection context for the workspace ──────────────
  let ctx: ConnectionRequestContext;
  try {
    ctx = await getOrCreatePullTokenContext(admin, result.workspaceId);
  } catch (err) {
    logger.error({ err }, "pull-token: failed to bootstrap synthetic connection");
    return Response.json({ error: "internal" }, { status: 500 });
  }

  // ── Create the proposal ────────────────────────────────────────────────
  let proposalId: string;
  try {
    const proposal = await createProposal(admin, ctx, proposalInput);
    proposalId = proposal.id;
  } catch (err) {
    logger.error({ err }, "pull-token: createProposal failed");
    return Response.json(
      { error: "proposal_creation_failed" },
      { status: 422 }
    );
  }

  // ── Audit (best-effort, attributed to the issuing user) ─────────────────
  const tokenId = await lookupPullTokenIdByString(admin, rawToken);
  auditBundlePulled(admin, result.workspaceId, result.userId, result.objectId, {
    token_id: tokenId,
    object_type: result.objectType,
    object_id: result.objectId,
    user_agent: userAgent,
    mode: "write",
  });

  return Response.json(
    {
      ok: true,
      proposalId,
      expiresAt: result.newExpiresAt,
    },
    {
      headers: {
        "X-Poggle-Expires-At": result.newExpiresAt,
        "X-Poggle-Expires-In": String(result.expiresInSeconds),
        "Cache-Control": "no-store",
      },
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ProposalInputOrError =
  | {
      proposal_type: "create_note" | "update_note" | "append_note";
      target_note_id?: string | null;
      target_folder_id?: string | null;
      proposed_title?: string | null;
      proposed_content?: string | null;
      proposed_summary?: string | null;
      proposed_tags?: string[] | null;
      rationale?: string | null;
    }
  | { error: string };

function mapKindToProposalInput(
  kind: "create_note" | "update_note" | "append_to_note",
  payload: Record<string, unknown>,
  tokenObjectId: string
): ProposalInputOrError {
  const asStr = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;

  if (kind === "create_note") {
    const folderId = asStr(payload.folder_id) ?? asStr(payload.target_folder_id);
    if (!folderId) return { error: "missing_folder_id" };
    return {
      proposal_type: "create_note",
      target_folder_id: folderId,
      proposed_title: asStr(payload.title),
      proposed_content: asStr(payload.content),
      proposed_summary: asStr(payload.summary),
      proposed_tags: Array.isArray(payload.tags)
        ? (payload.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : null,
      rationale: asStr(payload.rationale),
    };
  }

  if (kind === "update_note") {
    return {
      proposal_type: "update_note",
      target_note_id: tokenObjectId,
      proposed_title: asStr(payload.title),
      proposed_content: asStr(payload.content),
      proposed_summary: asStr(payload.summary),
      proposed_tags: Array.isArray(payload.tags)
        ? (payload.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : null,
      rationale: asStr(payload.rationale),
    };
  }

  // append_to_note maps to the existing append_note proposal_type
  return {
    proposal_type: "append_note",
    target_note_id: tokenObjectId,
    proposed_content: asStr(payload.content),
    rationale: asStr(payload.rationale),
  };
}

/**
 * Lazily provision (or look up) a per-workspace synthetic "pull_token"
 * connection record and surface it as a `ConnectionRequestContext` so we
 * can call `write_proposal_service.createProposal`.
 *
 * The synthetic connection is `permission_mode = propose_writes`, status
 * 'active', name 'Send to AI (pull-tokens)', metadata.kind='pull_token'.
 * It owns no tokens. The connection_id is needed only to satisfy the FK
 * on `write_proposals.connection_id`.
 *
 * `allowedBoxIds` is computed dynamically from all boxes in the workspace
 * — pull-tokens are workspace-scoped, the per-token authorization happens
 * at issuance time.
 */
async function getOrCreatePullTokenContext(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<ConnectionRequestContext> {
  // Look for an existing synthetic connection for this workspace.
  const existing = await admin
    .from("connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("name", PULL_TOKEN_CONNECTION_NAME)
    .maybeSingle();

  let connection: Connection | null =
    existing.data ? (existing.data as Connection) : null;

  if (!connection) {
    const created = await admin
      .from("connections")
      .insert({
        workspace_id: workspaceId,
        name: PULL_TOKEN_CONNECTION_NAME,
        description: "Synthetic actor for pull-token write proposals",
        connection_type: CONNECTION_TYPE.INTERNAL,
        status: CONNECTION_STATUS.ACTIVE,
        permission_mode: PERMISSION_MODE.PROPOSE_WRITES,
        metadata: { kind: "pull_token" },
      })
      .select()
      .single();
    if (created.error || !created.data) {
      throw new Error(
        `Failed to provision pull-token connection: ${created.error?.message}`
      );
    }
    connection = created.data as Connection;
  }

  // Resolve allowedBoxIds — every active box in the workspace.
  const { data: boxRows } = await admin
    .from("boxes")
    .select("id")
    .eq("workspace_id", workspaceId);

  const allowedBoxIds = new Set<string>();
  if (Array.isArray(boxRows)) {
    for (const row of boxRows as Array<{ id: string }>) {
      allowedBoxIds.add(row.id);
    }
  }

  return {
    connection,
    workspaceId,
    allowedBoxIds,
    // No real token row — this connection is invoked through the
    // pull-token route, not bearer auth. Use an empty string so the
    // type checker stays happy; nothing in the proposal path reads it.
    tokenId: "",
  };
}

const PULL_TOKEN_CONNECTION_NAME = "Send to AI (pull-tokens)";
