/**
 * Connection and token vocabularies.
 */

export const CONNECTION_TYPE = {
  MCP: "mcp",
  API_TOKEN: "api_token",
  INTERNAL: "internal",
} as const;

export type ConnectionType =
  (typeof CONNECTION_TYPE)[keyof typeof CONNECTION_TYPE];

export const CONNECTION_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  REVOKED: "revoked",
} as const;

export type ConnectionStatus =
  (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

/**
 * What operations a connection may perform.
 *
 * 'read_only'                   — may only read notes and metadata
 * 'propose_writes'              — may submit write_proposals for human review
 * 'generate_in_allowed_folders' — may write directly to folders where
 *                                 accepts_generated_notes = true
 */
export const PERMISSION_MODE = {
  READ_ONLY: "read_only",
  PROPOSE_WRITES: "propose_writes",
  GENERATE_IN_ALLOWED_FOLDERS: "generate_in_allowed_folders",
} as const;

export type PermissionMode =
  (typeof PERMISSION_MODE)[keyof typeof PERMISSION_MODE];

export const TOKEN_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
  EXPIRED: "expired",
} as const;

export type TokenStatus = (typeof TOKEN_STATUS)[keyof typeof TOKEN_STATUS];
