/**
 * WorkspaceObject — shared structural registry entry.
 *
 * Every content object (note, file, skill, agent, folder) is registered here
 * at creation time. This table is the canonical source for:
 *   - Tree participation (box + folder placement)
 *   - Cross-object indexing (search, graph, overview)
 *   - Permission targeting
 *   - Audit targeting
 *
 * object_type + object_id forms a polymorphic pointer to the owning core table.
 * display_name is denormalized from the core table and kept in sync by the service layer.
 *
 * is_reusable = true means this is a workspace-level shared skill or agent,
 * not box-local. Reusable objects may have box_id = null and can be attached
 * into multiple boxes via box_object_attachments.
 */
import { type ObjectType, type ObjectStatus } from "../constants/object_constants";

export interface WorkspaceObject {
  id: string;
  workspace_id: string;
  box_id: string | null;
  folder_id: string | null;
  object_type: ObjectType;
  object_id: string;
  display_name: string;
  sort_order: number;
  status: ObjectStatus;
  is_reusable: boolean;
  created_at: string;
  updated_at: string;
}
