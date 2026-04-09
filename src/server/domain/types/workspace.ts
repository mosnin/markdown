import { type WorkspaceStatus } from "../constants/content_status";

/**
 * Domain type: Workspace
 *
 * Matches the public.workspaces table shape.
 * In V1, one user owns one workspace. Multi-workspace and collaboration
 * are future concerns.
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

/** Minimal workspace identity — safe to carry in request context. */
export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
}
