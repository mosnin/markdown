import { z } from "zod";
import { SOURCE_FORMAT, OBJECT_STATUS, OBJECT_ORIGIN_TYPE } from "../constants/object_constants";

const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export const createSkillSchema = z.object({
  workspace_id: z.string().uuid(),
  box_id: z.string().uuid().nullable().optional(),
  folder_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(500),
  slug: z.string().regex(slugRegex),
  path_cache: z.string().min(1),
  source_content: z.string().default(""),
  canonical_format: z.enum([
    SOURCE_FORMAT.MARKDOWN,
    SOURCE_FORMAT.JSON,
    SOURCE_FORMAT.YAML,
    SOURCE_FORMAT.XML,
    SOURCE_FORMAT.JAVASCRIPT,
    SOURCE_FORMAT.SHELL,
    SOURCE_FORMAT.PLAIN_TEXT,
    SOURCE_FORMAT.TYPESCRIPT,
    SOURCE_FORMAT.PYTHON,
  ]).default(SOURCE_FORMAT.MARKDOWN),
  description: z.string().nullish(),
  summary: z.string().max(2000).nullish(),
  tags: z.array(z.string()).default([]),
  is_reusable: z.boolean().default(false),
  origin_type: z.enum([
    OBJECT_ORIGIN_TYPE.USER_CREATED,
    OBJECT_ORIGIN_TYPE.IMPORTED,
    OBJECT_ORIGIN_TYPE.GENERATED,
  ]).default(OBJECT_ORIGIN_TYPE.USER_CREATED),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;

export const updateSkillSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  source_content: z.string().optional(),
  description: z.string().nullish(),
  summary: z.string().max(2000).nullish(),
  tags: z.array(z.string()).optional(),
  status: z.enum([
    OBJECT_STATUS.DRAFT,
    OBJECT_STATUS.ACTIVE,
    OBJECT_STATUS.ARCHIVED,
    OBJECT_STATUS.TRASHED,
  ]).optional(),
  folder_id: z.string().uuid().nullable().optional(),
  current_version_id: z.string().uuid().nullable().optional(),
});

export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
