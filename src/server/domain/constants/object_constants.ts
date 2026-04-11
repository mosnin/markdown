/**
 * Object model constants.
 *
 * These mirror the CHECK constraints in the database schema for the
 * workspace_objects, files, skills, agents, object_versions, object_links,
 * and box_object_attachments tables.
 */

// Object types for the shared structural registry and cross-type relationships
export const OBJECT_TYPE = {
  NOTE: 'note',
  FILE: 'file',
  SKILL: 'skill',
  AGENT: 'agent',
  FOLDER: 'folder',
} as const;
export type ObjectType = typeof OBJECT_TYPE[keyof typeof OBJECT_TYPE];

// Which object types can be the source/target of object_links
export const LINKABLE_OBJECT_TYPES = [
  OBJECT_TYPE.NOTE,
  OBJECT_TYPE.FILE,
  OBJECT_TYPE.SKILL,
  OBJECT_TYPE.AGENT,
  OBJECT_TYPE.FOLDER,
] as const;

// Which object types can be workspace-level reusable (attached by reference)
export const REUSABLE_OBJECT_TYPES = [
  OBJECT_TYPE.SKILL,
  OBJECT_TYPE.AGENT,
] as const;

// Which object types have version history in object_versions
export const VERSIONED_OBJECT_TYPES = [
  OBJECT_TYPE.FILE,
  OBJECT_TYPE.SKILL,
  OBJECT_TYPE.AGENT,
] as const;

// Canonical source format for files, skills, and agents.
// Notes are always markdown — this enum is NOT for notes.
export const SOURCE_FORMAT = {
  PLAIN_TEXT: 'plain_text',
  JSON: 'json',
  YAML: 'yaml',
  TOML: 'toml',
  XML: 'xml',
  PYTHON: 'python',
  TYPESCRIPT: 'typescript',
  JAVASCRIPT: 'javascript',
  SHELL: 'shell',
  SQL: 'sql',
  HTML: 'html',
  CSS: 'css',
  MARKDOWN: 'markdown',
  BINARY: 'binary',
} as const;
export type SourceFormat = typeof SOURCE_FORMAT[keyof typeof SOURCE_FORMAT];

// Source formats valid for skills and agents (subset of SOURCE_FORMAT)
export const SKILL_AGENT_FORMATS = [
  SOURCE_FORMAT.MARKDOWN,
  SOURCE_FORMAT.JSON,
  SOURCE_FORMAT.YAML,
  SOURCE_FORMAT.TYPESCRIPT,
  SOURCE_FORMAT.PYTHON,
] as const;
export type SkillAgentFormat = typeof SKILL_AGENT_FORMATS[number];

// Agent type taxonomy (extensible — 'custom' is the escape hatch)
export const AGENT_TYPE = {
  REASONING: 'reasoning',
  CODING: 'coding',
  RESEARCH: 'research',
  PLANNING: 'planning',
  RETRIEVAL: 'retrieval',
  SYNTHESIS: 'synthesis',
  ORCHESTRATION: 'orchestration',
  CUSTOM: 'custom',
} as const;
export type AgentType = typeof AGENT_TYPE[keyof typeof AGENT_TYPE];

// Origin type for files, skills, and agents
export const OBJECT_ORIGIN_TYPE = {
  USER_CREATED: 'user_created',
  IMPORTED: 'imported',
  GENERATED: 'generated',
} as const;
export type ObjectOriginType = typeof OBJECT_ORIGIN_TYPE[keyof typeof OBJECT_ORIGIN_TYPE];

// Shared status vocabulary for files, skills, agents, and workspace_objects
// (mirrors NOTE_STATUS — kept in sync deliberately)
export const OBJECT_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  TRASHED: 'trashed',
} as const;
export type ObjectStatus = typeof OBJECT_STATUS[keyof typeof OBJECT_STATUS];
