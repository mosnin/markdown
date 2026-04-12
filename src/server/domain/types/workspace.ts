import { type WorkspaceStatus } from "../constants/content_status";

/**
 * Domain type: Workspace
 *
 * Matches the public.workspaces table shape. Workspaces have a single
 * canonical owner (`owner_id`) but may carry any number of members via
 * workspace_memberships (viewer / member / admin roles). Access checks
 * in the app flow through `WorkspaceContext.role` below.
 */
export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
}

/** Role the calling user holds on the active workspace. */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

/** Minimal workspace identity — safe to carry in request context. */
export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  /** Caller's role on this workspace. Used for server-side write gating. */
  role: WorkspaceRole;
}
