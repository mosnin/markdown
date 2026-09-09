import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/server/domain/errors";
import { mintRelayToken } from "@/server/auth/relay_auth";
import {
  CONNECTION_STATUS,
  TOKEN_STATUS,
} from "@/server/domain/constants/connection_constants";
import {
  createConnection as repoCreateConnection,
  createConnectionToken,
  getConnectionById,
  listTokensByConnection,
  updateConnection,
  updateConnectionToken,
} from "@/server/repositories/connection_repository";

/**
 * Relay key management.
 *
 * A relay key is the credential a hook shim carries: `pgr_v1_<64hex>`, pasted
 * once into `~/.poggle/config.json` on a laptop or a CI runner. Without one,
 * nothing about this product works — the shim has no way to authenticate and
 * every event it collects is dropped.
 *
 * Stored as a `connections` row of type `agent_hook` plus a `connection_tokens`
 * row, reusing the existing prefix-and-hash storage. Deliberately a separate
 * service from `connection_service` rather than a flag on it, because the two
 * differ in every way that matters:
 *
 *   - No box scopes. A relay key reaches the session log and nothing else; box
 *     scoping is a concept from the previous product.
 *   - No connected-agent quota. That cap counts legacy csk_v1_ connections and
 *     was sized for a different product. Metering a developer's own laptops
 *     against it would be a strange tax; a flat per-workspace ceiling below
 *     guards against runaway creation instead.
 *   - Different expiry posture (see `createRelayKey`).
 */

/**
 * Ceiling on live relay keys per workspace.
 *
 * Not a monetisation lever — a sanity bound. One key per machine per person is
 * the expected shape, so a workspace pushing past this is either a large team
 * that should say so, or a script in a loop.
 */
export const MAX_RELAY_KEYS_PER_WORKSPACE = 25;

export interface RelayKeySummary {
  connection_id: string;
  name: string;
  description: string | null;
  status: string;
  /** First 8 hex characters — enough to recognise a key, useless as a secret. */
  token_prefix: string | null;
  token_status: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface CreateRelayKeyResult {
  key: RelayKeySummary;
  /** The full secret. Shown once and never recoverable. */
  token: string;
}

/**
 * Create a relay key.
 *
 * Expiry defaults to none, which is a deliberate departure from the connection
 * tokens this reuses. A hook key that silently expires mid-session does not
 * fail loudly — it fails as an empty handoff brief three weeks later, when
 * somebody needed context and there was none, with no obvious cause. That is a
 * worse outcome than a long-lived credential whose blast radius is append-only
 * writes to one workspace's session log.
 *
 * Revocation is the control instead, and `last_used_at` on the listing makes a
 * forgotten key visible. Callers wanting a bounded credential — CI, a
 * contractor — pass `expiresAt` explicitly.
 */
export async function createRelayKey(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  input: { name: string; description?: string | null; expiresAt?: string | null }
): Promise<CreateRelayKeyResult> {
  const name = input.name?.trim();
  if (!name) {
    throw new ValidationError("A name is required so you can tell keys apart later");
  }
  if (name.length > 200) {
    throw new ValidationError("Name must be 200 characters or fewer");
  }

  const existing = await listRelayKeys(supabase, workspaceId);
  const live = existing.filter((k) => k.status === CONNECTION_STATUS.ACTIVE);
  if (live.length >= MAX_RELAY_KEYS_PER_WORKSPACE) {
    throw new ValidationError(
      `This workspace already has ${live.length} active relay keys (limit ${MAX_RELAY_KEYS_PER_WORKSPACE}). Revoke one you no longer use.`
    );
  }

  const connection = await repoCreateConnection(supabase, {
    workspace_id: workspaceId,
    name,
    description: input.description ?? null,
    connection_type: "agent_hook",
    // Append-only writes to the session log. The relay auth path reads this as
    // "may write"; the database enforces that writing means appending.
    permission_mode: "propose_writes",
    metadata: { created_by: actorId, kind: "relay_key" },
  });

  const minted = mintRelayToken();
  await createConnectionToken(supabase, {
    connection_id: connection.id,
    token_prefix: minted.token_prefix,
    secret_hash: minted.secret_hash,
    label: "Relay key",
    expires_at: input.expiresAt ?? null,
  });

  logger.info(
    { workspaceId, connectionId: connection.id, actorId },
    "Relay key created"
  );

  return {
    token: minted.token,
    key: {
      connection_id: connection.id,
      name: connection.name,
      description: connection.description,
      status: connection.status,
      token_prefix: minted.token_prefix,
      token_status: TOKEN_STATUS.ACTIVE,
      last_used_at: null,
      expires_at: input.expiresAt ?? null,
      created_at: connection.created_at,
    },
  };
}

/**
 * List a workspace's relay keys.
 *
 * Returns the token prefix and `last_used_at` but never the secret — there is
 * no code path that can recover it, by design. A key whose `last_used_at` is
 * null or stale is the signal that a machine was retired without anyone
 * revoking its credential.
 */
export async function listRelayKeys(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<RelayKeySummary[]> {
  const { data, error } = await supabase
    .from("connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("connection_type", "agent_hook")
    .neq("status", CONNECTION_STATUS.REVOKED)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list relay keys: ${error.message}`);
  }

  const connections = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    last_used_at: string | null;
    created_at: string;
  }>;

  const summaries: RelayKeySummary[] = [];
  for (const connection of connections) {
    const tokens = await listTokensByConnection(supabase, connection.id);
    const active =
      tokens.find((t) => t.status === TOKEN_STATUS.ACTIVE) ?? tokens[0] ?? null;

    summaries.push({
      connection_id: connection.id,
      name: connection.name,
      description: connection.description,
      status: connection.status,
      token_prefix: active?.token_prefix ?? null,
      token_status: active?.status ?? null,
      // The token's own usage timestamp is more precise than the connection's.
      last_used_at: active?.last_used_at ?? connection.last_used_at,
      expires_at: active?.expires_at ?? null,
      created_at: connection.created_at,
    });
  }

  return summaries;
}

/**
 * Revoke a relay key.
 *
 * Revokes the tokens and the connection together. Anything already logged
 * stays: the log is append-only and a revoked key's history is exactly the
 * history you would want to keep after revoking it.
 */
export async function revokeRelayKey(
  supabase: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  actorId: string
): Promise<void> {
  const connection = await getConnectionById(supabase, connectionId);
  if (
    !connection ||
    connection.workspace_id !== workspaceId ||
    connection.connection_type !== "agent_hook"
  ) {
    throw new ValidationError("Relay key not found");
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

  await updateConnection(supabase, connectionId, {
    status: CONNECTION_STATUS.REVOKED,
  });

  logger.info({ workspaceId, connectionId, actorId }, "Relay key revoked");
}

/**
 * Rotate a relay key's secret in place.
 *
 * The connection keeps its identity, so the key's name and history survive and
 * only the secret changes. Old tokens are revoked immediately rather than given
 * an overlap window: an unattended shim cannot be asked to migrate gracefully,
 * so a clean cut with a clear "paste this into the machine again" is more
 * honest than a grace period nobody acts on.
 */
export async function rotateRelayKey(
  supabase: SupabaseClient,
  workspaceId: string,
  connectionId: string,
  actorId: string
): Promise<{ token: string; token_prefix: string }> {
  const connection = await getConnectionById(supabase, connectionId);
  if (
    !connection ||
    connection.workspace_id !== workspaceId ||
    connection.connection_type !== "agent_hook"
  ) {
    throw new ValidationError("Relay key not found");
  }
  if (connection.status !== CONNECTION_STATUS.ACTIVE) {
    throw new ValidationError("Cannot rotate a revoked key — create a new one");
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

  const minted = mintRelayToken();
  await createConnectionToken(supabase, {
    connection_id: connectionId,
    token_prefix: minted.token_prefix,
    secret_hash: minted.secret_hash,
    label: "Rotated relay key",
    expires_at: null,
  });

  logger.info({ workspaceId, connectionId, actorId }, "Relay key rotated");

  return { token: minted.token, token_prefix: minted.token_prefix };
}
