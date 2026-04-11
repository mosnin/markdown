/**
 * Skill — reusable structured building block.
 *
 * Skills are first-class reusable objects that encapsulate a specific
 * capability in a canonical editable source format. They can be:
 *   - Box-local (box_id set, is_reusable = false): private to a single box
 *   - Workspace-level reusable (box_id may be null, is_reusable = true):
 *     shared across the workspace and attachable into multiple boxes by reference
 *
 * canonical_format: one chosen at creation/import time. Other formats are
 *   generated read-only export views, not coequal editable sources.
 *
 * Reusable skills attached into boxes appear via box_object_attachments.
 * External writes to workspace-level reusable skills must be proposals only.
 */
import { type SkillAgentFormat, type ObjectStatus, type ObjectOriginType } from "../constants/object_constants";

export interface Skill {
  id: string;
  workspace_id: string;
  box_id: string | null;
  folder_id: string | null;
  name: string;
  slug: string;
  path_cache: string;
  source_content: string;
  content_bytes: number;
  canonical_format: SkillAgentFormat;
  description: string | null;
  summary: string | null;
  tags: string[];
  is_reusable: boolean;
  status: ObjectStatus;
  current_version_id: string | null;
  origin_type: ObjectOriginType;
  created_at: string;
  updated_at: string;
}
