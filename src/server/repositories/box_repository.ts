import { type SupabaseClient } from "@supabase/supabase-js";
import { type Box } from "@/server/domain/types/box";
import {
  type CreateBoxInput,
  type UpdateBoxInput,
} from "@/server/domain/schemas/box_schemas";
import { BOX_STATUS } from "@/server/domain/constants/content_status";
import { logger } from "@/lib/logger";
import { NotFoundError, ConflictError, RepositoryError } from "@/server/domain/errors";

const BOX_COLS =
  "id, workspace_id, guide_note_id, name, slug, description, status, branch_id, agent_instructions, is_public, share_version, created_at, updated_at";

/**
 * Box repository.
 *
 * Note on guide_note_id:
 *   Clearing or changing guide_note_id must go through updateBox().
 *   The service layer is responsible for ensuring a guide note is not
 *   trashed while still set as boxes.guide_note_id.
 */

export async function getBoxById(
  supabase: SupabaseClient,
  id: string
): Promise<Box | null> {
  const { data, error } = await supabase
    .from("boxes")
    .select(BOX_COLS)
    .eq("id", id)
    .single();

  if (error || !data) {
    logger.warn({ id, error }, "[box_repository] getBoxById failed");
    return null;
  }
  return data as Box;
}

export async function getBoxBySlug(
  supabase: SupabaseClient,
  workspace_id: string,
  slug: string
): Promise<Box | null> {
  const { data, error } = await supabase
    .from("boxes")
    .select(BOX_COLS)
    .eq("workspace_id", workspace_id)
    .eq("slug", slug)
    .neq("status", BOX_STATUS.TRASHED)
    .single();

  if (error || !data) {
    logger.warn({ workspace_id, slug, error }, "[box_repository] getBoxBySlug failed");
    return null;
  }
  return data as Box;
}

export async function listBoxesByWorkspace(
  supabase: SupabaseClient,
  workspace_id: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<Box[]> {
  let query = supabase
    .from("boxes")
    .select(BOX_COLS)
    .eq("workspace_id", workspace_id)
    .neq("status", BOX_STATUS.TRASHED);

  if (!includeArchived) {
    query = query.neq("status", BOX_STATUS.ARCHIVED);
  }

  const { data, error } = await query.order("name", { ascending: true });
  if (error || !data) {
    logger.warn({ workspace_id, error }, "[box_repository] listBoxesByWorkspace failed");
    return [];
  }
  return data as Box[];
}

export async function createBox(
  supabase: SupabaseClient,
  input: CreateBoxInput
): Promise<Box> {
  const { data, error } = await supabase
    .from("boxes")
    .insert(input)
    .select(BOX_COLS)
    .single();

  if (error || !data) throw new RepositoryError("createBox", error);
  return data as Box;
}

export async function updateBox(
  supabase: SupabaseClient,
  id: string,
  input: UpdateBoxInput
): Promise<Box | null> {
  const { data, error } = await supabase
    .from("boxes")
    .update(input)
    .eq("id", id)
    .select(BOX_COLS)
    .single();

  if (error || !data) throw new RepositoryError("updateBox", error);
  return data as Box;
}

/**
 * Increment a box's share_version, invalidating every previously issued
 * share link for it (the share page requires the token's version to match
 * the live row). Returns the new version.
 *
 * Supabase has no atomic column-increment over the JS client, so we read
 * the current value and write +1. A concurrent double-bump could collapse
 * two increments into one, but the only effect is that one extra-stale link
 * survives a beat — revocation is still monotonic and never *un*-revokes.
 */
export async function bumpBoxShareVersion(
  supabase: SupabaseClient,
  id: string
): Promise<number> {
  const { data: current, error: readError } = await supabase
    .from("boxes")
    .select("share_version")
    .eq("id", id)
    .single();
  if (readError || !current) throw new RepositoryError("bumpBoxShareVersion", readError);

  const next = (current.share_version as number) + 1;
  const { data, error } = await supabase
    .from("boxes")
    .update({ share_version: next })
    .eq("id", id)
    .select("share_version")
    .single();
  if (error || !data) throw new RepositoryError("bumpBoxShareVersion", error);
  return data.share_version as number;
}

export async function listPublicBoxesByWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Box[]> {
  const { data, error } = await supabase
    .from("boxes")
    .select(BOX_COLS)
    .eq("workspace_id", workspaceId)
    .eq("is_public", true)
    .eq("status", "active")
    .order("name");
  if (error || !data) {
    logger.warn({ workspaceId, error }, "[box_repository] listPublicBoxesByWorkspace failed");
    return [];
  }
  return data as Box[];
}

export async function getWorkspaceBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<{ id: string; name: string; slug: string } | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (error || !data) {
    logger.warn({ slug, error }, "[box_repository] getWorkspaceBySlug failed");
    return null;
  }
  return data as { id: string; name: string; slug: string };
}
