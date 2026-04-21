import { z } from "zod";
import { BOX_STATUS } from "../constants/content_status";

const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export const createBoxSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().regex(slugRegex),
  description: z.string().max(1000).nullish(),
});

export type CreateBoxInput = z.infer<typeof createBoxSchema>;

export const updateBoxSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullish(),
  status: z.enum([
    BOX_STATUS.DRAFT,
    BOX_STATUS.ACTIVE,
    BOX_STATUS.ARCHIVED,
    BOX_STATUS.TRASHED,
  ]).optional(),
  guide_note_id: z.string().uuid().nullable().optional(),
  agent_instructions: z.string().max(4000).nullable().optional(),
  is_public: z.boolean().optional(),
});

export type UpdateBoxInput = z.infer<typeof updateBoxSchema>;
