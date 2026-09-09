import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/logger";
import { resolveMcpRequestAuth } from "@/server/auth/mcp_auth_adapter";
import { hasScope } from "@/server/services/oauth_scope_service";
import {
  CONNECTION_STATUS,
  TOKEN_STATUS,
} from "@/server/domain/constants/connection_constants";
import {
  getConnectionById,
  getConnectionTokenByPrefix,
  updateConnection,
  updateConnectionToken,
} from "@/server/repositories/connection_repository";

/**
 * Authentication for the agent context relay.
 *
 * Hooks are a different kind of client from everything else that talks to this
 * app. They run unattended, inside an agent's own process, on a laptop or a CI
 * runner. There is no browser to redirect, nobody to click Approve, and often
 * no terminal to read a prompt from. An OAuth authorization-code dance is not
 * available to them at the moment they need to log an event.
 *
 * So the relay accepts two token families:
 *
 *   1. Relay keys — `pgr_v1_<64hex>`. Long-lived, workspace-scoped, minted
 *      from the dashboard and pasted into a hook config once. Stored exactly
 *      like connection tokens (prefix for lookup, sha256 for verification),
 *      but under a connection of type 'agent_hook' and resolved here rather
 *      than through the deprecated csk_v1_ path, which is env-gated off in
 *      production and should stay that way.
 *
 *   2. OAuth access tokens — for MCP connectors and anything user-interactive,
 *      gated on the `relay:read` / `relay:write` scopes.
 *
 * Relay keys are deliberately powerful within one workspace and deliberately
 * incapable outside it: they can append to the log and read briefs, and they
 * can do nothing else. The log is append-only at the database level, so a
 * leaked relay key cannot be used to rewrite history — only to add to it, and
 * everything it adds is attributed to its connection.
 */

export const RELAY_TOKEN_PREFIX = "pgr_v1_";
const RELAY_TOKEN_RE = /^pgr_v1_[0-9a-f]{64}$/;

export interface RelayAuthContext {
  /** Which token family authenticated this request. */
  source: "relay_key" | "oauth";
  workspaceId: string;
  /** The connections row (relay key) or synthesized OAuth connection id. */
  connectionId: string;
  tokenId: string;
  /** May append to the log. */
  canWrite: boolean;
  /** May read the log and fetch briefs. */
  canRead: boolean;
}

// ─── Minting ────────────────────────────────────────────────────────────────

export interface MintedRelayToken {
  /** The full secret. Shown once, never stored, never recoverable. */
  token: string;
  token_prefix: string;
  secret_hash: string;
}

/**
 * Generate a relay key.
 *
 * The caller is responsible for persisting `token_prefix` + `secret_hash`
 * against a connection and for showing `token` to the user exactly once.
 */
export function mintRelayToken(): MintedRelayToken {
  const hex = randomBytes(32).toString("hex");
  return {
    token: `${RELAY_TOKEN_PREFIX}${hex}`,
    token_prefix: hex.slice(0, 8),
    secret_hash: createHash("sha256").update(hex).digest("hex"),
  };
}

/** Cheap structural check, before any database work. */
export function looksLikeRelayToken(raw: string): boolean {
  return RELAY_TOKEN_RE.test(raw);
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve a relay key to its workspace.
 *
 * Returns null for every failure mode — bad format, unknown prefix, revoked
 * token, expired token, suspended connection, wrong connection type. Callers
 * respond 401 without distinguishing, so a probe learns nothing about which
 * part was wrong.
 */
async function resolveRelayKey(rawToken: string): Promise<RelayAuthContext | null> {
  if (!looksLikeRelayToken(rawToken)) return null;

  const hex = rawToken.slice(RELAY_TOKEN_PREFIX.length);
  const providedHash = createHash("sha256").update(hex).digest("hex");
  const tokenPrefix = hex.slice(0, 8);

  const admin = createAdminClient();

  const tokenRecord = await getConnectionTokenByPrefix(admin, tokenPrefix);
  if (!tokenRecord) return null;
  if (tokenRecord.status !== TOKEN_STATUS.ACTIVE) return null;
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
    return null;
  }

  // Constant-time compare so a timing signal cannot be used to walk the hash.
  const stored = Buffer.from(tokenRecord.secret_hash, "hex");
  const provided = Buffer.from(providedHash, "hex");
  if (stored.length !== provided.length) return null;
  if (!timingSafeEqual(stored, provided)) return null;

  const connection = await getConnectionById(admin, tokenRecord.connection_id);
  if (!connection) return null;
  if (connection.status !== CONNECTION_STATUS.ACTIVE) return null;
  // A relay key must belong to a relay connection. This is what stops an old
  // integration credential from silently gaining ingest rights.
  if (connection.connection_type !== "agent_hook") return null;

  void recordUsage(connection.id, tokenRecord.id);

  return {
    source: "relay_key",
    workspaceId: connection.workspace_id,
    connectionId: connection.id,
    tokenId: tokenRecord.id,
    canWrite: connection.permission_mode !== "read_only",
    canRead: true,
  };
}

/**
 * Resolve any relay request: relay key first, then OAuth.
 *
 * Order matters only for speed — the two token formats are disjoint, so a
 * token can never satisfy both paths.
 */
export async function resolveRelayAuth(
  request: Request
): Promise<RelayAuthContext | null> {
  try {
    const header = request.headers.get("authorization");
    if (!header || !header.startsWith("Bearer ")) return null;
    const raw = header.slice(7).trim();

    if (raw.startsWith(RELAY_TOKEN_PREFIX)) {
      return await resolveRelayKey(raw);
    }

    const mcpCtx = await resolveMcpRequestAuth(request);
    if (!mcpCtx) return null;

    return {
      source: "oauth",
      workspaceId: mcpCtx.workspaceId,
      connectionId: mcpCtx.connectionId,
      tokenId: mcpCtx.tokenId,
      canWrite: hasScope(mcpCtx.scopes, "relay:write"),
      canRead:
        hasScope(mcpCtx.scopes, "relay:read") ||
        hasScope(mcpCtx.scopes, "relay:write"),
    };
  } catch (err) {
    log.error("relay_auth_exception", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

/** Fire-and-forget usage tracking. Never allowed to fail a request. */
async function recordUsage(connectionId: string, tokenId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    await Promise.all([
      updateConnection(admin, connectionId, { last_used_at: now }),
      updateConnectionToken(admin, tokenId, { last_used_at: now }),
    ]);
  } catch {
    // Intentionally swallowed.
  }
}
