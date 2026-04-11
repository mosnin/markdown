import { z } from "zod";
import { SOURCE_FORMAT, OBJECT_STATUS, OBJECT_ORIGIN_TYPE } from "../constants/object_constants";

// Files can have slugs with dots for extensions: e.g. 'config.json' → slug 'config.json'
const fileSlugRegex = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/;

export const createFileSchema = z.object({
  workspace_id: z.string().uuid(),
  box_id: z.string().uuid().nullable().optional(),
  folder_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(500),
  slug: z.string().regex(fileSlugRegex),
  path_cache: z.string().min(1),
  source_content: z.string().default(""),
  canonical_format: z.enum([
    SOURCE_FORMAT.PLAIN_TEXT,
    SOURCE_FORMAT.JSON,
    SOURCE_FORMAT.YAML,
    SOURCE_FORMAT.TOML,
    SOURCE_FORMAT.XML,
    SOURCE_FORMAT.PYTHON,
    SOURCE_FORMAT.TYPESCRIPT,
    SOURCE_FORMAT.JAVASCRIPT,
    SOURCE_FORMAT.SHELL,
    SOURCE_FORMAT.SQL,
    SOURCE_FORMAT.HTML,
    SOURCE_FORMAT.CSS,
    SOURCE_FORMAT.MARKDOWN,
    SOURCE_FORMAT.BINARY,
  ]).default(SOURCE_FORMAT.PLAIN_TEXT),
  source_language: z.string().nullish(),
  file_extension: z.string().nullish(),
  mime_type: z.string().nullish(),
  description: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  summary: z.string().max(2000).nullish(),
  origin_type: z.enum([
    OBJECT_ORIGIN_TYPE.USER_CREATED,
    OBJECT_ORIGIN_TYPE.IMPORTED,
    OBJECT_ORIGIN_TYPE.GENERATED,
  ]).default(OBJECT_ORIGIN_TYPE.USER_CREATED),
});

export type CreateFileInput = z.infer<typeof createFileSchema>;

export const updateFileSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  source_content: z.string().optional(),
  description: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  summary: z.string().max(2000).nullish(),
  status: z.enum([
    OBJECT_STATUS.DRAFT,
    OBJECT_STATUS.ACTIVE,
    OBJECT_STATUS.ARCHIVED,
    OBJECT_STATUS.TRASHED,
  ]).optional(),
  folder_id: z.string().uuid().nullable().optional(),
  current_version_id: z.string().uuid().nullable().optional(),
});

export type UpdateFileInput = z.infer<typeof updateFileSchema>;
