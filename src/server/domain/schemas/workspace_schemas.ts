import { z } from "zod";

/**
 * Zod schemas for workspace repository inputs.
 * These validate data entering the repository layer, not the API layer.
 */

const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export const createWorkspaceSchema = z.object({
  owner_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z.string().regex(slugRegex, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(1000).nullish(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullish(),
  agent_instructions: z.string().max(4000).nullable().optional(),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
