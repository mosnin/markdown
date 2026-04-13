import {
  type ConnectionType,
  type ConnectionStatus,
  type PermissionMode,
  type TokenStatus,
} from "../constants/connection_constants";

/**
 * Domain type: Connection
 *
 * Represents an authorized external agent (MCP client, API integration,
 * webhook) with scoped access to one workspace.
 */
export interface Connection {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  connection_type: ConnectionType;
  status: ConnectionStatus;
  permission_mode: PermissionMode;
  last_used_at: string | null;
  usage_count: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Domain type: ConnectionToken
 *
 * A credential token for a connection. The raw secret is never stored —
 * only the prefix (for lookup) and the hashed secret (for verification).
 */
export interface ConnectionToken {
  id: string;
  connection_id: string;
  token_prefix: string;
  secret_hash: string;
  label: string | null;
  status: TokenStatus;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  /**
   * Most recent time the MCP auth adapter emitted a deprecation
   * warning for this token. Nullable; added with
   * 20260413000006_mcp_auth_hardening.
   */
  last_warned_at: string | null;
  created_at: string;
}

/**
 * Domain type: ConnectionBoxScope
 *
 * Records which box a connection has access to.
 * Box is the scope unit in V1.
 */
export interface ConnectionBoxScope {
  id: string;
  connection_id: string;
  box_id: string;
  created_at: string;
}
