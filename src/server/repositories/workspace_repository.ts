import { type SupabaseClient } from "@supabase/supabase-js";
import { type Workspace } from "@/server/domain/types/workspace";
import {
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
} from "@/server/domain/schemas/workspace_schemas";
import { WORKSPACE_STATUS } from "@/server/domain/constants/content_status";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Workspace repository.
 *
 * Data access only — no business logic. Callers (services) are responsible
 * for authorization checks before calling these functions.
 *
 * All functions accept a Supabase client so they work with both the server
 * client (human session) and any future service-role client.
 */

export async function getWorkspaceById(
  supabase: SupabaseClient,
  id: string
): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Workspace;
}

export async function getWorkspaceByOwnerAndSlug(
  supabase: SupabaseClient,
  owner_id: string,
  slug: string
): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_id", owner_id)
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return data as Workspace;
}

/** Returns all active workspaces owned by a user. */
export async function listWorkspacesByOwner(
  supabase: SupabaseClient,
  owner_id: string
): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_id", owner_id)
    .eq("status", WORKSPACE_STATUS.ACTIVE)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data as Workspace[];
}

/**
 * Create a workspace, or return the existing row when one already exists
 * for the same (owner_id, slug).
 *
 * First-login bootstrap can fire two concurrent renders (layout + page),
 * each calling `getOrCreateDefaultWorkspace` -> `createWorkspace` with the
 * same deterministic slug. A plain INSERT makes the loser hit
 * `workspaces_owner_id_slug_key` and throw, rendering error.tsx on first
 * login. Upserting on the unique key makes the race self-healing: both
 * callers converge on the same row. `onConflict` does an idempotent
 * DO UPDATE (re-stamping the name) so the existing row is always returned.
 */
export async function createWorkspace(
  supabase: SupabaseClient,
  input: CreateWorkspaceInput
): Promise<Workspace> {
  const { data, error } = await supabase
    .from("workspaces")
    .upsert(input, { onConflict: "owner_id,slug" })
    .select()
    .single();

  if (error || !data) throw new RepositoryError("createWorkspace", error);
  return data as Workspace;
}

export async function updateWorkspace(
  supabase: SupabaseClient,
  id: string,
  input: UpdateWorkspaceInput
): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Workspace;
}
