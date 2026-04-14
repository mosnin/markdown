import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/logger";
import {
  parseBearerAccessToken,
  resolveAccessToken,
} from "@/server/services/oauth_token_service";
import {
  parseScopeString,
  splitScopes,
  hasScope,
  type OAuthScope,
  type OAuthCapabilityScope,
} from "@/server/services/oauth_scope_service";
import { getWorkspaceRole } from "@/server/repositories/workspace_membership_repository";
import {
  getConnectionTokenByPrefix,
  getConnectionById,
  listBoxScopesByConnection,
  updateConnectionToken,
} from "@/server/repositories/connection_repository";
import {
  CONNECTION_STATUS,
  TOKEN_STATUS,
  type PermissionMode,
} from "@/server/domain/constants/connection_constants";
import { createAuditEvent } from "@/server/repositories/audit_event_repository";

/**
 * Unified authentication adapter for Context Store's MCP and
 * canonical API surfaces.
 *
 * OAuth access tokens are accepted:
 *
 *   1. `cso_a_…` — OAuth 2.1 access tokens. PRIMARY public flow.
 *      Resolves to (user, workspace, client, scopes, role).
 *      Audit attribution captures BOTH the user (as actor) and the
 *      client (as metadata.oauth_client_id).
 *
 * Legacy `csk_v1_…` connection tokens are now fully rejected on
 * HTTP/API surfaces.
 *
 * The unified return shape (`McpAuthContext`) lets route handlers
 * carry a single resolved auth object regardless of the source.
 */

export type McpAuthSource = "oauth" | "legacy_csk";

export interface McpAuthContext {
  /** Which token family authenticated this request. */
  source: McpAuthSource;
  /**
   * The authenticated human user id. For OAuth, this is the user who
   * consented. For legacy csk_v1_, this is null because legacy
   * connection tokens are workspace-scoped, not user-scoped.
   */
  userId: string | null;
  /** Workspace the token is scoped to. Always present. */
  workspaceId: string;
  /**
   * Workspace role used for write gating. Null for legacy csk_v1_
   * (which pre-dates workspace memberships); callers should treat
   * null as "use connection.permission_mode only".
   */
  role: "owner" | "admin" | "member" | "viewer" | null;
  /** Parsed capability + box-narrowing scopes (empty for legacy). */
  scopes: OAuthScope[];
  /**
   * Set of box ids this request may touch. For OAuth, it is the
   * intersection of workspace-live boxes and granted box-scopes.
   * For legacy csk_v1_, it is the connection's box-scoped set.
   */
  allowedBoxIds: Set<string>;
  /**
   * OAuth client_id. Only populated when source === 'oauth'. The
   * route handler stamps this into audit metadata so MCP calls are
   * traceable to the connector that made them.
   */
  clientId: string | null;
  /**
   * For OAuth: the synthesized connection id (== oauth_access_token.id).
   * For legacy: the real `connections.id` row.
   */
  connectionId: string;
  /**
   * Legacy permission_mode (read_only | propose_writes |
   * generate_in_allowed_folders). For OAuth, this is derived from the
   * granted scopes so downstream services that expect a
   * permission_mode keep working unchanged.
   */
  permissionMode: PermissionMode;
  /** Internal — used for last_used_at tracking. */
  tokenId: string;
  /**
   * True when the resolver observed a deprecated token. Route
   * handlers should add a `Deprecation: true` response header.
   */
  deprecated: boolean;
}

// ─── Env flag ────────────────────────────────────────────────────────────────

/**
 * Whether legacy csk_v1_ tokens are permitted by this process.
 * Legacy token acceptance has been retired and is always false.
 */
export function legacyCskEnabled(): boolean {
  // Legacy csk_v1_ acceptance has been retired from HTTP/API auth
  // surfaces. Kept as an explicit constant-false helper so callers and
  // tests can assert shutdown status.
  return false;
}

// ─── Public resolver ─────────────────────────────────────────────────────────

/**
 * Resolve an incoming MCP / canonical-API request into a unified auth
 * context. Returns null for any auth failure; callers respond with
 * 401.
 *
 * The decision tree is:
 *
 *   1. If the Authorization header parses as an OAuth access token,
 *      resolve it through oauth_token_service and build an OAuth
 *      McpAuthContext.
 *   2. Else, if the token looks like a legacy csk_v1_, reject it.
 *   3. Else, return null.
 */
export async function resolveMcpRequestAuth(
  request: Request
): Promise<McpAuthContext | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const raw = header.slice(7).trim();

  // Path 1 — OAuth.
  if (raw.startsWith("cso_a_")) {
    return await resolveOAuth(header);
  }

  // Path 2 — legacy csk_v1_ is fully retired on HTTP/API auth
  // surfaces. Keep rejection explicit for diagnostics.
  if (raw.startsWith("csk_v1_")) {
    log.warn("mcp_auth_legacy_token_rejected_retired");
    return null;
  }

  return null;
}

// ─── OAuth path ──────────────────────────────────────────────────────────────

async function resolveOAuth(
  authHeader: string
): Promise<McpAuthContext | null> {
  const parsed = parseBearerAccessToken(authHeader);
  if (!parsed) return null;

  const admin = createAdminClient();
  const resolved = await resolveAccessToken(admin, parsed);
  if (!resolved) return null;

  const role = await getWorkspaceRole(admin, resolved.workspaceId, resolved.userId);
  if (!role) return null;

  // Live workspace boxes, intersected with box-narrowing scopes (if
  // any). A token with no box scope gets every non-trashed box.
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

  const permissionMode: PermissionMode = hasScope(resolved.scope, "context:generate")
    ? "generate_in_allowed_folders"
    : hasScope(resolved.scope, "context:propose")
      ? "propose_writes"
      : "read_only";

  return {
    source: "oauth",
    userId: resolved.userId,
    workspaceId: resolved.workspaceId,
    role,
    scopes: resolved.scope,
    allowedBoxIds,
    clientId: resolved.clientId,
    connectionId: resolved.tokenId,
    permissionMode,
    tokenId: resolved.tokenId,
    deprecated: false,
  };
}

// ─── Legacy csk_v1_ path ─────────────────────────────────────────────────────

async function resolveLegacyCsk(
  rawToken: string
): Promise<McpAuthContext | null> {
  const hex = rawToken.slice(7);
  if (hex.length !== 64 || !/^[0-9a-f]{64}$/.test(hex)) return null;

  const tokenPrefix = hex.slice(0, 8);
  const providedHash = createHash("sha256").update(hex).digest("hex");

  const admin = createAdminClient();
  const tokenRecord = await getConnectionTokenByPrefix(admin, tokenPrefix);
  if (!tokenRecord) return null;
  if (tokenRecord.status !== TOKEN_STATUS.ACTIVE) return null;
  if (
    tokenRecord.expires_at &&
    new Date(tokenRecord.expires_at) < new Date()
  ) {
    return null;
  }

  const storedHashBuf = Buffer.from(tokenRecord.secret_hash, "hex");
  const providedHashBuf = Buffer.from(providedHash, "hex");
  if (storedHashBuf.length !== providedHashBuf.length) return null;
  if (!timingSafeEqual(storedHashBuf, providedHashBuf)) return null;

  const connection = await getConnectionById(admin, tokenRecord.connection_id);
  if (!connection) return null;
  if (connection.status !== CONNECTION_STATUS.ACTIVE) return null;

  const scopes = await listBoxScopesByConnection(admin, connection.id);
  const allowedBoxIds = new Set(scopes.map((s) => s.box_id));

  // Rate-limited deprecation audit: at most 1 event per token per hour.
  await emitLegacyTokenUsed(admin, connection.workspace_id, tokenRecord.id, {
    connectionId: connection.id,
    tokenPrefix,
    lastWarnedAt: tokenRecord.last_warned_at ?? null,
  });

  return {
    source: "legacy_csk",
    userId: null,
    workspaceId: connection.workspace_id,
    role: null,
    scopes: [],
    allowedBoxIds,
    clientId: null,
    connectionId: connection.id,
    permissionMode: connection.permission_mode,
    tokenId: tokenRecord.id,
    deprecated: true,
  };
}

async function emitLegacyTokenUsed(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  tokenId: string,
  info: {
    connectionId: string;
    tokenPrefix: string;
    lastWarnedAt: string | null;
  }
): Promise<void> {
  try {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent =
      info.lastWarnedAt && new Date(info.lastWarnedAt).getTime() > oneHourAgo;
    if (recent) return;

    await updateConnectionToken(admin, tokenId, {
      last_warned_at: new Date().toISOString(),
    });

    await createAuditEvent(admin, {
      workspace_id: workspaceId,
      actor_type: "connection",
      actor_id: info.connectionId,
      object_type: "connection_token",
      object_id: tokenId,
      event_type: "mcp.legacy_token_used",
      metadata: {
        token_prefix: info.tokenPrefix,
        auth_source: "legacy_csk",
        notice:
          "csk_v1_ tokens are deprecated. Migrate to OAuth 2.1 via /api/oauth.",
      },
    });
  } catch (err) {
    // Audit writes must never fail the primary operation.
    log.warn("mcp_legacy_token_audit_failed", {
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}

// ─── Response header helpers ─────────────────────────────────────────────────

/**
 * Standard headers to attach to any response authenticated with a
 * deprecated token. Advertises the sunset policy so connectors
 * surface the warning to their users.
 */
export function legacyDeprecationHeaders(): Record<string, string> {
  return {
    Deprecation: "true",
    Link: '</docs/mcp_v1.md>; rel="deprecation"',
    Warning:
      '299 - "csk_v1_ tokens are deprecated. Migrate to OAuth at /oauth/authorize."',
  };
}

// ─── Convenience guards ──────────────────────────────────────────────────────

/**
 * Enforce that the resolved context grants the required capability
 * scope. OAuth contexts are gated on scope; legacy contexts short-
 * circuit-true so the existing permission_mode flow runs unchanged.
 */
export function requireScope(
  ctx: McpAuthContext,
  required: OAuthCapabilityScope
): boolean {
  if (ctx.source === "legacy_csk") return true;
  return hasScope(ctx.scopes, required);
}

/**
 * Enforce that the caller's workspace role permits writes. Viewers
 * are rejected regardless of scope. Legacy csk_v1_ has no role
 * (pre-membership era); it falls through to permission_mode only.
 */
export function requireWrite(ctx: McpAuthContext): boolean {
  if (ctx.source === "legacy_csk") return ctx.permissionMode !== "read_only";
  return ctx.role !== null && ctx.role !== "viewer";
}

// Re-export parseScopeString so tests and other callers don't need
// to import it through the service directly.
export { parseScopeString };
