import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/logger";
import { type Connection } from "@/server/domain/types/connection";
import { resolveMcpRequestAuth } from "@/server/auth/mcp_auth_adapter";

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

/**
 * Unified connection-context resolver for canonical /api/v1 routes.
 *
 * This function now delegates all bearer parsing + verification to the
 * MCP auth adapter so /api/v1 and /api/mcp share the same source of
 * truth for:
 *   - OAuth token validity
 *   - workspace membership re-checking
 *   - legacy-token policy gates
 *   - permission mode derivation
 *
 * For OAuth-authenticated requests, writes are hard-blocked when the
 * caller's current role is `viewer`, even if the token carries a write
 * scope. We encode that by forcing permission_mode=read_only in the
 * synthetic Connection shape so existing route-level checks remain
 * unchanged.
 */
export async function getConnectionContext(
  request: Request
): Promise<ConnectionRequestContext | null> {
  try {
    const auth = await resolveMcpRequestAuth(request);
    if (!auth) return null;

    const permissionMode =
      auth.source === "oauth" && auth.role === "viewer"
        ? "read_only"
        : auth.permissionMode;

    const syntheticConnection: Connection = {
      id: auth.connectionId,
      workspace_id: auth.workspaceId,
      name: auth.source === "oauth" && auth.clientId ? `oauth:${auth.clientId}` : "connection",
      description: null,
      connection_type: "mcp",
      status: "active",
      permission_mode: permissionMode,
      last_used_at: null,
      usage_count: 0,
      metadata:
        auth.source === "oauth"
          ? {
              auth_source: "oauth",
              oauth_client_id: auth.clientId,
              oauth_user_id: auth.userId,
              scope: auth.scopes.join(" "),
              workspace_role: auth.role,
            }
          : {
              auth_source: "legacy_csk",
            },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (auth.source === "legacy_csk") {
      void recordLegacyUsage(auth.connectionId, auth.tokenId);
    }

    return {
      connection: syntheticConnection,
      workspaceId: auth.workspaceId,
      allowedBoxIds: auth.allowedBoxIds,
      tokenId: auth.tokenId,
    };
  } catch (err) {
    log.error("connection_auth_exception", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

async function recordLegacyUsage(connectionId: string, tokenId: string): Promise<void> {
  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  await Promise.all([
    adminClient.from("connections").update({ last_used_at: now }).eq("id", connectionId),
    adminClient.from("connection_tokens").update({ last_used_at: now }).eq("id", tokenId),
  ]).catch(() => {
    // Intentionally swallowed — usage tracking must not abort the request.
  });
}
