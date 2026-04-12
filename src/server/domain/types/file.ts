/**
 * File — non-markdown content artifact.
 *
 * Files represent all non-markdown saved artifacts: JSON configs, YAML schemas,
 * Python scripts, TypeScript modules, shell scripts, SQL queries, etc.
 *
 * Distinction from Note:
 *   - Notes are ALWAYS markdown. Files are NEVER the canonical markdown document type.
 *   - Files have explicit format metadata (canonical_format, source_language, file_extension).
 *   - Files have version history via object_versions (not note_versions).
 *   - Files do not have kind, read_hint, retrieval_priority, or is_generated fields.
 *
 * canonical_format: the one editable source format chosen at creation or import time.
 *   Stays fixed unless explicitly converted. Other representations are read-only exports.
 */
import { type SourceFormat, type ObjectStatus, type ObjectOriginType } from "../constants/object_constants";

export interface File {
  id: string;
  workspace_id: string;
  box_id: string | null;
  folder_id: string | null;
  parent_skill_id: string | null;
  parent_agent_id: string | null;
  name: string;
  slug: string;
  path_cache: string;
  source_content: string;
  content_bytes: number;
  canonical_format: SourceFormat;
  source_language: string | null;
  file_extension: string | null;
  mime_type: string | null;
  description: string | null;
  tags: string[];
  summary: string | null;
  status: ObjectStatus;
  current_version_id: string | null;
  origin_type: ObjectOriginType;
  created_at: string;
  updated_at: string;
}
