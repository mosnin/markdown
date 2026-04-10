import { randomBytes, createHash } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  type Connection,
  type ConnectionToken,
  type ConnectionBoxScope,
} from "@/server/domain/types/connection";
import {
  type ConnectionType,
  type PermissionMode,
  CONNECTION_STATUS,
  TOKEN_STATUS,
} from "@/server/domain/constants/connection_constants";
import {
  createConnection as repoCreateConnection,
  updateConnection as repoUpdateConnection,
  getConnectionById,
  listConnectionsByWorkspace,
  createConnectionToken,
  listTokensByConnection,
  updateConnectionToken,
  addBoxScope as repoAddBoxScope,
  removeBoxScope as repoRemoveBoxScope,
  listBoxScopesByConnection,
} from "@/server/repositories/connection_repository";
import {
  auditConnectionCreated,
  auditConnectionRevoked,
  auditConnectionUpdated,
  auditTokenRotated,
} from "@/server/services/audit_service";

// ─── Token expiry defaults ────────────────────────────────────────────────────

/**
 * Default token lifetime in days.
 *
 * New tokens (initial and rotated) expire after this many days by default.
 * 90 days was chosen as a reasonable private beta default — long enough to
 * avoid operational friction, short enough to bound the window for a
 * compromised or forgotten token.
 *
 * To issue a token without expiry (e.g. for an automated internal integration),
 * pass an explicit `expires_at: null` to `createConnectionToken()` directly.
 * That path is intentionally bypassed by this default and should be used
 * deliberately, not accidentally.
 */
const DEFAULT_TOKEN_EXPIRY_DAYS = 90;

function defaultExpiresAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_TOKEN_EXPIRY_DAYS);
  return d.toISOString();
}

// ─── Token generation ─────────────────────────────────────────────────────────

/**
 * Generate a fresh API token.
 *
 * Token format shown to the user: csk_v1_<64hex>
 *   - "csk" = Context Store Key
 *   - "v1"  = token format version
 *
 * Stored in DB:
 *   - token_prefix: first 8 hex chars — used for fast DB lookup
 *   - secret_hash:  sha256(<64hex>) — used for constant-time verification
 *
 * The raw token is NEVER stored. It is shown to the user exactly once.
 */
function generateToken(): {
  rawToken: string;
  token_prefix: string;
  secret_hash: string;
} {
  const hex = randomBytes(32).toString("hex"); // 64 hex chars
  return {
    rawToken: `csk_v1_${hex}`,
    token_prefix: hex.slice(0, 8),
    secret_hash: createHash("sha256").update(hex).digest("hex"),
  };
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────

export interface CreateConnectionInput {
  name: string;
  description?: string | null;
  connection_type: ConnectionType;
  permission_mode: PermissionMode;
  /** Box IDs to scope this connection to. Empty = no access to any box. */
  boxIds?: string[];
}

export interface CreateConnectionResult {
  connection: Connection;
  /** The one-time raw token — display to the user and discard. */
  rawToken: string;
}

/**
 * Create a new connection with an initial bearer token.
 * Returns the raw token — this is the only time it is available.
 *
 * Caller must verify that all boxIds belong to the given workspaceId
 * before calling this function.
 */
export async function createConnection(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  input: CreateConnectionInput
): Promise<CreateConnectionResult> {
  const connection = await repoCreateConnection(supabase, {
    workspace_id: workspaceId,
    name: input.name,
    description: input.description ?? null,
    connection_type: input.connection_type,
    permission_mode: input.permission_mode,
  });

  const { rawToken, token_prefix, secret_hash } = generateToken();
  await createConnectionToken(supabase, {
    connection_id: connection.id,
    token_prefix,
    secret_hash,
    label: "Initial token",
    expires_at: defaultExpiresAt(),
  });

  if (input.boxIds?.length) {
    await Promise.all(
      input.boxIds.map((boxId) => repoAddBoxScope(supabase, connection.id, boxId))
    );
  }

  void auditConnectionCreated(supabase, workspaceId, actorId, connection.id, {
    name: connection.name,
    permission_mode: connection.permission_mode,
  });

  return { connection, rawToken };
}

/**
 * Rotate the token for a connection.
 * All existing active tokens are revoked; a new one is generated.
 * Returns the new raw token — show once and discard.
 */
export async function rotateConnectionToken(
  supabase: SupabaseClient,
  connectionId: string,
  workspaceId: string,
  actorId: string
): Promise<{ rawToken: string }> {
  const connection = await getConnectionById(supabase, connectionId);
  if (!connection || connection.workspace_id !== workspaceId) {
    throw new Error("Connection not found");
  }
  if (connection.status !== CONNECTION_STATUS.ACTIVE) {
    throw new Error("Connection is not active");
  }

  const existing = await listTokensByConnection(supabase, connectionId);
  const now = new Date().toISOString();
  await Promise.all(
    existing
      .filter((t) => t.status === TOKEN_STATUS.ACTIVE)
      .map((t) =>
        updateConnectionToken(supabase, t.id, {
          status: TOKEN_STATUS.REVOKED,
          revoked_at: now,
        })
      )
  );

  const { rawToken, token_prefix, secret_hash } = generateToken();
  await createConnectionToken(supabase, {
    connection_id: connectionId,
    token_prefix,
    secret_hash,
    label: "Rotated token",
    expires_at: defaultExpiresAt(),
  });

  void auditTokenRotated(supabase, workspaceId, actorId, connectionId);

  return { rawToken };
}

/**
 * Revoke a connection.
 * All active tokens are revoked; the connection status is set to 'revoked'.
 */
export async function revokeConnection(
  supabase: SupabaseClient,
  connectionId: string,
  workspaceId: string,
  actorId: string
): Promise<void> {
  const connection = await getConnectionById(supabase, connectionId);
  if (!connection || connection.workspace_id !== workspaceId) {
    throw new Error("Connection not found");
  }

  const now = new Date().toISOString();
  const tokens = await listTokensByConnection(supabase, connectionId);
  await Promise.all(
    tokens
      .filter((t) => t.status === TOKEN_STATUS.ACTIVE)
      .map((t) =>
        updateConnectionToken(supabase, t.id, {
          status: TOKEN_STATUS.REVOKED,
          revoked_at: now,
        })
      )
  );

  await repoUpdateConnection(supabase, connectionId, {
    status: CONNECTION_STATUS.REVOKED,
  });

  void auditConnectionRevoked(supabase, workspaceId, actorId, connectionId, {
    name: connection.name,
  });
}

/**
 * Update connection metadata (name, description, permission_mode).
 * Does not affect tokens or box scopes.
 */
export async function updateConnectionMeta(
  supabase: SupabaseClient,
  connectionId: string,
  workspaceId: string,
  actorId: string,
  input: {
    name?: string;
    description?: string | null;
    permission_mode?: PermissionMode;
  }
): Promise<Connection> {
  const connection = await getConnectionById(supabase, connectionId);
  if (!connection || connection.workspace_id !== workspaceId) {
    throw new Error("Connection not found");
  }

  const updated = await repoUpdateConnection(supabase, connectionId, input);
  if (!updated) throw new Error("Failed to update connection");

  void auditConnectionUpdated(supabase, workspaceId, actorId, connectionId, {
    name: updated.name,
  });

  return updated;
}

// ─── Box scope management ─────────────────────────────────────────────────────

/**
 * Add a box scope to a connection.
 * Caller must verify the box belongs to workspaceId first.
 */
export async function addConnectionBoxScope(
  supabase: SupabaseClient,
  connectionId: string,
  workspaceId: string,
  boxId: string
): Promise<ConnectionBoxScope> {
  const connection = await getConnectionById(supabase, connectionId);
  if (!connection || connection.workspace_id !== workspaceId) {
    throw new Error("Connection not found");
  }
  return repoAddBoxScope(supabase, connectionId, boxId);
}

/**
 * Remove a box scope from a connection.
 */
export async function removeConnectionBoxScope(
  supabase: SupabaseClient,
  connectionId: string,
  workspaceId: string,
  boxId: string
): Promise<void> {
  const connection = await getConnectionById(supabase, connectionId);
  if (!connection || connection.workspace_id !== workspaceId) {
    throw new Error("Connection not found");
  }
  await repoRemoveBoxScope(supabase, connectionId, boxId);
}

// ─── Pause / unpause ─────────────────────────────────────────────────────────

/**
 * Toggle a connection between active and paused.
 * Revoked connections cannot be paused or unpaused.
 */
export async function toggleConnectionPause(
  supabase: SupabaseClient,
  connectionId: string,
  workspaceId: string,
  actorId: string
): Promise<Connection> {
  const connection = await getConnectionById(supabase, connectionId);
  if (!connection || connection.workspace_id !== workspaceId) {
    throw new Error("Connection not found");
  }
  if (connection.status === CONNECTION_STATUS.REVOKED) {
    throw new Error("Cannot pause or unpause a revoked connection");
  }

  const newStatus =
    connection.status === CONNECTION_STATUS.ACTIVE
      ? CONNECTION_STATUS.PAUSED
      : CONNECTION_STATUS.ACTIVE;

  const updated = await repoUpdateConnection(supabase, connectionId, {
    status: newStatus,
  });
  if (!updated) throw new Error("Failed to update connection status");

  void auditConnectionUpdated(supabase, workspaceId, actorId, connectionId, {
    name: updated.name,
  });

  return updated;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export interface ConnectionWithScopes extends Connection {
  box_scopes: ConnectionBoxScope[];
  /** expires_at from the most recently created active token, or null */
  token_expires_at: string | null;
}

/**
 * List all non-revoked connections for a workspace, with their box scopes
 * and the expiry date of the most recent active token.
 */
export async function listConnectionsWithScopes(
  supabase: SupabaseClient,
  workspaceId: string,
  { includeRevoked = false }: { includeRevoked?: boolean } = {}
): Promise<ConnectionWithScopes[]> {
  const connections = await listConnectionsByWorkspace(supabase, workspaceId, {
    includeRevoked,
  });

  return Promise.all(
    connections.map(async (conn) => {
      const [box_scopes, tokens] = await Promise.all([
        listBoxScopesByConnection(supabase, conn.id),
        listTokensByConnection(supabase, conn.id),
      ]);

      // Find the most recently created active token's expiry
      const activeTokens = tokens.filter(
        (t) => t.status === TOKEN_STATUS.ACTIVE
      );
      const latestActive = activeTokens[activeTokens.length - 1] ?? null;
      const token_expires_at = latestActive?.expires_at ?? null;

      return { ...conn, box_scopes, token_expires_at };
    })
  );
}
