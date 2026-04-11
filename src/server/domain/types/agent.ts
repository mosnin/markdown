/**
 * Agent — reusable structured orchestrator.
 *
 * Agents are first-class reusable objects that represent structured AI
 * orchestration logic with a canonical editable source format, structured
 * core fields (agent_type, model_hint, system_prompt), optional child files,
 * optional nested folders, and skill references.
 *
 * Context Store stores, organizes, relates, retrieves, exports, and safely
 * updates agents. It does NOT execute them.
 *
 * model_hint: a reference/preference for which model to use. This is NOT
 *   an execution config — it is metadata that downstream callers may use.
 *
 * system_prompt: the agent's system prompt in canonical text form.
 *   This is part of the editable source and included in version history.
 *
 * Reusable agents (is_reusable = true) follow the same attachment model as skills.
 * External writes to reusable agents must be proposals only.
 */
import { type SkillAgentFormat, type AgentType, type ObjectStatus, type ObjectOriginType } from "../constants/object_constants";

export interface Agent {
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
  agent_type: AgentType | null;
  model_hint: string | null;
  system_prompt: string | null;
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
