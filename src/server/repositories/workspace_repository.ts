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

export async function createWorkspace(
  supabase: SupabaseClient,
  input: CreateWorkspaceInput
): Promise<Workspace> {
  const { data, error } = await supabase
    .from("workspaces")
    .insert(input)
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
