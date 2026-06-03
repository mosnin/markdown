// -----------------------------------------------------------------------------
// INTENTIONALLY RETAINED — do not delete.
//
// A security audit flagged this module as "dead (zero importers)". That is
// incorrect: the `ConnectionRequestContext` type exported below is the
// canonical contract that the `/api/v1/**` service layer is written against —
// it is imported by `write_proposal_service.ts`, `generated_note_service.ts`,
// and is the bridge target of `mcp_auth_adapter.ts`'s
// `toConnectionRequestContext()`. Deleting this file would break all three.
//
// The `getConnectionContext()` FUNCTION (the csk_v1_ bearer-token path) is the
// part that is superseded: live MCP / API routes now authenticate via
// `mcp_auth_adapter.ts`. The function is kept because (a) it still defines the
// `ConnectionRequestContext` shape and the OAuth bridge `resolveOAuthContext`,
// and (b) `src/tests/unit/token_format.test.ts` documents its structural
// token checks. If the legacy csk_v1_ path is fully removed in future, extract
// the `ConnectionRequestContext` type + OAuth bridge first, then drop the rest.
// -----------------------------------------------------------------------------

import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/logger";
import { type Connection } from "@/server/domain/types/connection";
import {
  CONNECTION_STATUS,
  TOKEN_STATUS,
} from "@/server/domain/constants/connection_constants";
import {
  getConnectionTokenByPrefix,
  getConnectionById,
  listBoxScopesByConnection,
  updateConnectionToken,
  updateConnection,
} from "@/server/repositories/connection_repository";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Resolved context for an external API request authenticated via bearer token.
 *
 * Separate from RequestContext (human session auth) — do not conflate them.
 * ConnectionRequestContext carries no Supabase user; authorization is
 * performed entirely through the connection record and its box scopes.
 */
export interface ConnectionRequestContext {
  /** The authenticated connection record. */
  connection: Connection;
  /** The workspace this connection belongs to. */
  workspaceId: string;
  /**
   * Set of box IDs this connection is allowed to access.
   * Route handlers MUST check this before returning any box-scoped data.
   */
  allowedBoxIds: Set<string>;
  /** Internal — used for last_used_at tracking. */
  tokenId: string;
}

// ─── Token verification ───────────────────────────────────────────────────────

/**
 * Parse and verify an incoming bearer token from the Authorization header.
 *
 * Token format: "csk_v1_<64hex>"
 *   Bearer <token>  →  Authorization: Bearer csk_v1_<64hex>
 *
 * Verification steps:
 *   1. Structural check (prefix, length, hex alphabet)
 *   2. DB lookup by token_prefix (first 8 hex chars)
 *   3. Active status check on the token record
 *   4. Expiry check
 *   5. Constant-time sha256 hash comparison
 *   6. Active status check on the parent connection
 *
 * Returns null for any failure — callers should respond with 401.
 * Never throws; exceptions from DB are caught and treated as auth failure.
 *
 * IMPORTANT: Uses the admin Supabase client (bypasses RLS). This is intentional
 * because API requests have no user session. Route handlers must enforce all
 * authorization through ctx.allowedBoxIds and ctx.workspaceId.
 */
export async function getConnectionContext(
  request: Request
): Promise<ConnectionRequestContext | null> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return null;
    if (!authHeader.startsWith("Bearer ")) return null;

    const rawToken = authHeader.slice(7).trim();

    // The canonical /api/v1 endpoints now accept two token families:
    //
    //   1. csk_v1_<64hex>      — legacy connection token (connections +
    //                            connection_tokens). Kept for backward
    //                            compatibility; new integrations should
    //                            use OAuth.
    //   2. cso_a_<urlsafe_b64> — OAuth 2.1 access token issued via the
    //                            /api/oauth/token endpoint. Resolves to
    //                            an (oauth_client, user, workspace,
    //                            scope) triple.
    //
    // We dispatch on prefix so each family keeps its own verification
    // path. Both return the same ConnectionRequestContext shape so
    // every downstream route handler remains identical.
    if (rawToken.startsWith("cso_a_")) {
      return await resolveOAuthContext(rawToken);
    }
    if (!rawToken.startsWith("csk_v1_")) return null;

    const hex = rawToken.slice(7); // characters after "csk_v1_"
    if (hex.length !== 64 || !/^[0-9a-f]{64}$/.test(hex)) return null;

    const token_prefix = hex.slice(0, 8);
    const providedHash = createHash("sha256").update(hex).digest("hex");

    const adminClient = createAdminClient();

    const tokenRecord = await getConnectionTokenByPrefix(adminClient, token_prefix);
    if (!tokenRecord) return null;
    if (tokenRecord.status !== TOKEN_STATUS.ACTIVE) {
      log.warn("connection_token_inactive", { token_prefix });
      return null;
    }

    if (
      tokenRecord.expires_at &&
      new Date(tokenRecord.expires_at) < new Date()
    ) {
      log.warn("connection_token_expired", { token_prefix });
      return null;
    }

    // Constant-time comparison — prevents timing attacks on the hash
    const storedHashBuf = Buffer.from(tokenRecord.secret_hash, "hex");
    const providedHashBuf = Buffer.from(providedHash, "hex");
    if (storedHashBuf.length !== providedHashBuf.length) return null;
    if (!timingSafeEqual(storedHashBuf, providedHashBuf)) return null;

    const connection = await getConnectionById(
      adminClient,
      tokenRecord.connection_id
    );
    if (!connection) return null;
    if (connection.status !== CONNECTION_STATUS.ACTIVE) {
      log.warn("connection_inactive", {
        connection_id: connection.id,
        token_prefix,
      });
      return null;
    }

    const scopes = await listBoxScopesByConnection(adminClient, connection.id);
    const allowedBoxIds = new Set(scopes.map((s) => s.box_id));

    // Fire-and-forget: track last_used_at — never let this fail the request
    void recordUsage(adminClient, connection.id, tokenRecord.id);

    return {
      connection,
      workspaceId: connection.workspace_id,
      allowedBoxIds,
      tokenId: tokenRecord.id,
    };
  } catch (err) {
    log.error("connection_auth_exception", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

// ─── OAuth 2.1 access-token bridge ───────────────────────────────────────────

/**
 * Resolve a ConnectionRequestContext for an OAuth 2.1 bearer access
 * token. This is the bridge that lets the `/api/v1/**` handlers —
 * which were designed around the connection + connection_token model
 * — accept OAuth tokens without any per-route refactor.
 *
 * We synthesize a minimal `Connection` record from the oauth_client +
 * scope so downstream permission_mode checks keep working:
 *
 *   - `context:propose` in the scope set → permission_mode =
 *     propose_writes.
 *   - `context:generate` in the scope set → permission_mode =
 *     generate_in_allowed_folders.
 *   - Otherwise → read_only.
 *
 * `allowedBoxIds` is populated with every box in the authorized
 * workspace — OAuth scope is workspace-wide, not box-level, which
 * matches the product's membership model introduced in
 * 20260412000003. Connection box scopes remain a legacy concept tied
 * to the old connection_tokens path.
 */
async function resolveOAuthContext(
  rawToken: string
): Promise<ConnectionRequestContext | null> {
  // Dynamic imports to avoid a circular dep: oauth_token_service uses
  // the admin client which also imports from this file in some paths.
  const { parseBearerAccessToken, resolveAccessToken } = await import(
    "@/server/services/oauth_token_service"
  );
  const { hasScope, splitScopes } = await import(
    "@/server/services/oauth_scope_service"
  );
  const parsed = parseBearerAccessToken(`Bearer ${rawToken}`);
  if (!parsed) return null;

  const admin = createAdminClient();
  const resolved = await resolveAccessToken(admin, parsed);
  if (!resolved) return null;

  // Pull every active box in the workspace. Then apply two filters:
  //   1. Drop trashed boxes so revoked boxes can't be reached via a
  //      stale token.
  //   2. If the token has per-box scope narrowing
  //      (`context:box:<uuid>`), intersect the box set with the
  //      granted ids so the canonical API honours per-box grants too.
  //      Tokens without any box scope keep workspace-wide access.
  const { data: boxes } = await admin
    .from("boxes")
    .select("id")
    .eq("workspace_id", resolved.workspaceId)
    .neq("status", "trashed");
  const liveBoxIds = (boxes ?? []).map((b: { id: string }) => b.id);
  const { boxIds: grantedBoxIds } = splitScopes(resolved.scope);
  const allowedBoxIds = new Set(
    grantedBoxIds
      ? liveBoxIds.filter((id: string) => grantedBoxIds.has(id))
      : liveBoxIds
  );

  // Synthetic Connection shape. This is NOT a persisted row — it's a
  // transport-layer adapter so the service code paths that expect a
  // Connection keep working unchanged. The id carries the OAuth
  // client_id so audit attribution still points at the calling
  // connector.
  const permissionMode = hasScope(resolved.scope, "context:generate")
    ? "generate_in_allowed_folders"
    : hasScope(resolved.scope, "context:propose")
      ? "propose_writes"
      : "read_only";

  const syntheticConnection: Connection = {
    id: resolved.tokenId,
    workspace_id: resolved.workspaceId,
    name: `oauth:${resolved.clientId}`,
    description: null,
    connection_type: "mcp",
    status: "active",
    permission_mode: permissionMode,
    last_used_at: null,
    usage_count: 0,
    metadata: {
      auth_source: "oauth",
      oauth_client_id: resolved.clientId,
      oauth_user_id: resolved.userId,
      scope: resolved.scope.join(" "),
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    connection: syntheticConnection,
    workspaceId: resolved.workspaceId,
    allowedBoxIds,
    tokenId: resolved.tokenId,
  };
}

// ─── Usage tracking ───────────────────────────────────────────────────────────

async function recordUsage(
  adminClient: ReturnType<typeof createAdminClient>,
  connectionId: string,
  tokenId: string
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    updateConnection(adminClient, connectionId, { last_used_at: now }),
    updateConnectionToken(adminClient, tokenId, { last_used_at: now }),
  ]).catch(() => {
    // Intentionally swallowed — usage tracking must not abort the request
  });
}
