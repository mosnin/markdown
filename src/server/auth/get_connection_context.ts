import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
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
    if (!rawToken.startsWith("csk_v1_")) return null;

    const hex = rawToken.slice(7); // characters after "csk_v1_"
    if (hex.length !== 64 || !/^[0-9a-f]{64}$/.test(hex)) return null;

    const token_prefix = hex.slice(0, 8);
    const providedHash = createHash("sha256").update(hex).digest("hex");

    const adminClient = createAdminClient();

    const tokenRecord = await getConnectionTokenByPrefix(adminClient, token_prefix);
    if (!tokenRecord) return null;
    if (tokenRecord.status !== TOKEN_STATUS.ACTIVE) return null;

    if (
      tokenRecord.expires_at &&
      new Date(tokenRecord.expires_at) < new Date()
    ) {
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
    if (connection.status !== CONNECTION_STATUS.ACTIVE) return null;

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
  } catch {
    return null;
  }
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
