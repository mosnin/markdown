import { type SupabaseClient } from "@supabase/supabase-js";
import {
  type Connection,
  type ConnectionToken,
  type ConnectionBoxScope,
} from "@/server/domain/types/connection";
import {
  type ConnectionType,
  type ConnectionStatus,
  type PermissionMode,
  type TokenStatus,
  CONNECTION_STATUS,
  TOKEN_STATUS,
} from "@/server/domain/constants/connection_constants";

/**
 * Connection repository.
 *
 * Design notes:
 * - Raw token secrets are never stored here — only token_prefix and secret_hash.
 * - Token revocation uses updateConnectionToken({ status: 'revoked', revoked_at }).
 * - ConnectionBoxScopes are the canonical join for "what can this connection access".
 */

export interface CreateConnectionInput {
  workspace_id: string;
  name: string;
  description?: string | null;
  connection_type: ConnectionType;
  permission_mode: PermissionMode;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateConnectionInput {
  name?: string;
  description?: string | null;
  status?: ConnectionStatus;
  permission_mode?: PermissionMode;
  last_used_at?: string | null;
  usage_count?: number;
  metadata?: Record<string, unknown> | null;
}

export interface CreateConnectionTokenInput {
  connection_id: string;
  token_prefix: string;
  secret_hash: string;
  label?: string | null;
  expires_at?: string | null;
}

export interface UpdateConnectionTokenInput {
  status?: TokenStatus;
  label?: string | null;
  last_used_at?: string | null;
  revoked_at?: string | null;
  /**
   * Timestamp of the most recent deprecation warning emitted for this
   * token. Read/written by the MCP auth adapter to rate-limit
   * `mcp.legacy_token_used` audit events to at most 1/hour/token.
   */
  last_warned_at?: string | null;
}

// ─── Connection ───────────────────────────────────────────────────────────────

export async function getConnectionById(
  supabase: SupabaseClient,
  id: string
): Promise<Connection | null> {
  const { data, error } = await supabase
    .from("connections")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Connection;
}

export async function listConnectionsByWorkspace(
  supabase: SupabaseClient,
  workspace_id: string,
  { includeRevoked = false }: { includeRevoked?: boolean } = {}
): Promise<Connection[]> {
  let query = supabase
    .from("connections")
    .select("*")
    .eq("workspace_id", workspace_id);

  if (!includeRevoked) {
    query = query.neq("status", CONNECTION_STATUS.REVOKED);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as Connection[];
}

export async function createConnection(
  supabase: SupabaseClient,
  input: CreateConnectionInput
): Promise<Connection> {
  const { data, error } = await supabase
    .from("connections")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create connection");
  return data as Connection;
}

export async function updateConnection(
  supabase: SupabaseClient,
  id: string,
  input: UpdateConnectionInput
): Promise<Connection | null> {
  const { data, error } = await supabase
    .from("connections")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Connection;
}

// ─── Connection Tokens ────────────────────────────────────────────────────────

export async function getConnectionTokenByPrefix(
  supabase: SupabaseClient,
  token_prefix: string
): Promise<ConnectionToken | null> {
  const { data, error } = await supabase
    .from("connection_tokens")
    .select("*")
    .eq("token_prefix", token_prefix)
    .eq("status", TOKEN_STATUS.ACTIVE)
    .single();

  if (error || !data) return null;
  return data as ConnectionToken;
}

export async function listTokensByConnection(
  supabase: SupabaseClient,
  connection_id: string
): Promise<ConnectionToken[]> {
  const { data, error } = await supabase
    .from("connection_tokens")
    .select("*")
    .eq("connection_id", connection_id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as ConnectionToken[];
}

export async function createConnectionToken(
  supabase: SupabaseClient,
  input: CreateConnectionTokenInput
): Promise<ConnectionToken> {
  const { data, error } = await supabase
    .from("connection_tokens")
    .insert(input)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create connection token");
  return data as ConnectionToken;
}

export async function updateConnectionToken(
  supabase: SupabaseClient,
  id: string,
  input: UpdateConnectionTokenInput
): Promise<ConnectionToken | null> {
  const { data, error } = await supabase
    .from("connection_tokens")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as ConnectionToken;
}

// ─── Connection Box Scopes ────────────────────────────────────────────────────

export async function listBoxScopesByConnection(
  supabase: SupabaseClient,
  connection_id: string
): Promise<ConnectionBoxScope[]> {
  const { data, error } = await supabase
    .from("connection_box_scopes")
    .select("*")
    .eq("connection_id", connection_id)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as ConnectionBoxScope[];
}

export async function addBoxScope(
  supabase: SupabaseClient,
  connection_id: string,
  box_id: string
): Promise<ConnectionBoxScope> {
  const { data, error } = await supabase
    .from("connection_box_scopes")
    .insert({ connection_id, box_id })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to add box scope");
  return data as ConnectionBoxScope;
}

export async function removeBoxScope(
  supabase: SupabaseClient,
  connection_id: string,
  box_id: string
): Promise<boolean> {
  const { error } = await supabase
    .from("connection_box_scopes")
    .delete()
    .eq("connection_id", connection_id)
    .eq("box_id", box_id);

  return !error;
}

/** Check if a connection has been granted access to a specific box. */
export async function connectionHasBoxScope(
  supabase: SupabaseClient,
  connection_id: string,
  box_id: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("connection_box_scopes")
    .select("id")
    .eq("connection_id", connection_id)
    .eq("box_id", box_id)
    .single();

  return !error && !!data;
}
