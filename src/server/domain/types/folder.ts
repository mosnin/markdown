import { type FolderStatus } from "../constants/content_status";

/**
 * Domain type: Folder
 *
 * Matches the public.folders table shape.
 *
 * path_cache is a derived field (e.g. '/research/papers'). It is not
 * identity — the slug and parent_folder_id chain is authoritative.
 * path_cache must be kept in sync by the service layer when slugs change.
 *
 * accepts_generated_notes: when true, connections with
 * 'generate_in_allowed_folders' permission may write directly here.
 * Defaults false. Change with care — it widens machine write permissions.
 */
export interface Folder {
  id: string;
  workspace_id: string;
  box_id: string | null;
  parent_folder_id: string | null;
  parent_skill_id: string | null;
  parent_agent_id: string | null;
  name: string;
  slug: string;
  path_cache: string;
  description: string | null;
  accepts_generated_notes: boolean;
  status: FolderStatus;
  /**
   * Non-null when the folder exists only on a draft branch. Cleared
   * on promote; hard-deleted on discard. See
   * docs/branch_local_structural_creation_v1.md.
   */
  branch_id: string | null;
  created_at: string;
  updated_at: string;
}
