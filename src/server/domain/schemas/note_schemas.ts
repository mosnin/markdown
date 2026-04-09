import { z } from "zod";
import { NOTE_KIND, NOTE_ORIGIN_TYPE, NOTE_READ_HINT } from "../constants/note_constants";
import { NOTE_STATUS } from "../constants/content_status";

const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const readHintEnum = z.enum([
  NOTE_READ_HINT.READ_FIRST,
  NOTE_READ_HINT.CORE_REFERENCE,
  NOTE_READ_HINT.SUPPORTING_CONTEXT,
  NOTE_READ_HINT.RELATED,
  NOTE_READ_HINT.ARCHIVE_ONLY,
  NOTE_READ_HINT.GENERATED,
]).nullish();

export const createNoteSchema = z.object({
  box_id: z.string().uuid(),
  folder_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  slug: z.string().regex(slugRegex),
  path_cache: z.string().min(1),
  markdown_content: z.string().default(""),
  summary: z.string().max(2000).nullish(),
  tags: z.array(z.string()).default([]),
  read_hint: readHintEnum,
  retrieval_priority: z.number().int().min(0).max(10).default(0),
  kind: z.enum([NOTE_KIND.NOTE, NOTE_KIND.GUIDE, NOTE_KIND.BUNDLE]).default(NOTE_KIND.NOTE),
  origin_type: z
    .enum([
      NOTE_ORIGIN_TYPE.USER_CREATED,
      NOTE_ORIGIN_TYPE.IMPORTED,
      NOTE_ORIGIN_TYPE.GENERATED_BY_TOOL,
      NOTE_ORIGIN_TYPE.DUPLICATED,
      NOTE_ORIGIN_TYPE.RESTORED,
    ])
    .default(NOTE_ORIGIN_TYPE.USER_CREATED),
  is_generated: z.boolean().default(false),
  generated_by_connection_id: z.string().uuid().nullable().optional(),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  markdown_content: z.string().optional(),
  summary: z.string().max(2000).nullish(),
  tags: z.array(z.string()).optional(),
  read_hint: readHintEnum,
  retrieval_priority: z.number().int().min(0).max(10).optional(),
  status: z.enum([
    NOTE_STATUS.DRAFT,
    NOTE_STATUS.ACTIVE,
    NOTE_STATUS.ARCHIVED,
    NOTE_STATUS.TRASHED,
  ]).optional(),
  folder_id: z.string().uuid().nullable().optional(),
  current_version_id: z.string().uuid().nullable().optional(),
});

export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
