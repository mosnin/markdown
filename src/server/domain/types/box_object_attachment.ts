/**
 * BoxObjectAttachment — reusable skill/agent reference in a box.
 *
 * Models the attachment of a workspace-level reusable skill or agent into a
 * specific box. The reusable object (skills.is_reusable = true or
 * agents.is_reusable = true) remains owned at the workspace level.
 *
 * Attached objects:
 *   - Appear inside the box tree by reference (at folder_id, or box root)
 *   - Auto-reflect updates from the reusable source (no copying semantics)
 *   - Can be detached without affecting the source or other boxes
 *
 * This is distinct from a box-local skill/agent (box_id set on the skill/agent
 * itself, is_reusable = false), which belongs exclusively to that box.
 */

export interface BoxObjectAttachment {
  id: string;
  workspace_id: string;
  box_id: string;
  folder_id: string | null;
  object_type: 'skill' | 'agent';
  object_id: string;
  sort_order: number;
  attached_at: string;
  attached_by: string | null;
  /**
   * Non-null when the attachment exists only on a draft branch.
   * Cleared on promote; hard-deleted on discard. Main readers filter
   * to `branch_id IS NULL`; branch readers keep main + matching-
   * branch rows. See docs/branch_local_structural_creation_v1.md
   * (v1.10).
   */
  branch_id: string | null;
}
