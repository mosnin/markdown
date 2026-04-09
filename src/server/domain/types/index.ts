/**
 * Domain types — re-exported from this index.
 *
 * These types represent the core domain model of Context Store.
 * They are derived from the database schema but belong to the domain layer.
 *
 * Type layers in this codebase:
 *   Domain types (here): canonical shapes used across all server code
 *   DB-facing types:     same as domain types for now (no ORM mapping)
 *   API response types:  subset or projection of domain types (future)
 *   Client types:        serialized versions for browser (future)
 *
 * When Supabase type generation is set up, these can be replaced or
 * supplemented by generated types. Until then, these are the ground truth.
 */

export type { Workspace, WorkspaceContext } from "./workspace";
export type { Box } from "./box";
export type { Folder } from "./folder";
export type { Note } from "./note";
export type { NoteVersion } from "./note_version";
export type { NoteLink } from "./note_link";
export type { Connection, ConnectionToken, ConnectionBoxScope } from "./connection";
export type { WriteProposal } from "./write_proposal";
export type { AuditEvent } from "./audit_event";
