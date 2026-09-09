import { type SupabaseClient } from "@supabase/supabase-js";
import { type Project } from "@/server/domain/types/agent_session";
import { RepositoryError } from "@/server/domain/errors";

/**
 * Project repository.
 *
 * Projects are created implicitly by ingest: the first hook that fires from a
 * repo we have not seen names it, and we create it rather than rejecting the
 * event. Dropping an agent's first event because nobody clicked "New project"
 * would be the single most annoying possible failure mode, so `ensureProject`
 * is the primary entry point and plain `createProject` is the UI's path.
 */

export interface CreateProjectInput {
  workspace_id: string;
  name: string;
  slug: string;
  description?: string | null;
  repo_url?: string | null;
  default_branch?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  repo_url?: string | null;
  default_branch?: string | null;
  status?: "active" | "archived";
}

/**
 * Normalise an arbitrary string into a project slug.
 *
 * Accepts what a hook can cheaply produce — a repo URL, a directory name, a
 * display name — and yields something that satisfies the slug CHECK
 * constraint. Returns null when nothing usable survives, which the caller
 * must treat as a validation error rather than substituting a default.
 */
export function toProjectSlug(raw: string): string | null {
  const fromUrl = raw
    // git@github.com:owner/repo.git → owner/repo
    .replace(/^git@([^:]+):/, "")
    // https://github.com/owner/repo(.git) → owner/repo
    .replace(/^[a-z]+:\/\/[^/]+\//i, "")
    .replace(/\.git$/, "");

  const slug = fromUrl
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._/-]+/g, "-")
    // Path separators become dashes so owner/repo stays distinguishable.
    .replace(/\//g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .slice(0, 120)
    // Slicing can re-expose a trailing separator.
    .replace(/[^a-z0-9]+$/, "");

  return slug.length > 0 ? slug : null;
}

export async function getProjectById(
  client: SupabaseClient,
  projectId: string
): Promise<Project | null> {
  const { data, error } = await client
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw new RepositoryError(`Failed to load project: ${error.message}`);
  }
  return (data as Project) ?? null;
}

export async function getProjectBySlug(
  client: SupabaseClient,
  workspaceId: string,
  slug: string
): Promise<Project | null> {
  const { data, error } = await client
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new RepositoryError(`Failed to load project by slug: ${error.message}`);
  }
  return (data as Project) ?? null;
}

export async function listProjects(
  client: SupabaseClient,
  workspaceId: string,
  options: { includeArchived?: boolean; limit?: number } = {}
): Promise<Project[]> {
  let query = client
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_active_at", { ascending: false, nullsFirst: false })
    .limit(options.limit ?? 100);

  if (!options.includeArchived) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query;
  if (error) {
    throw new RepositoryError(`Failed to list projects: ${error.message}`);
  }
  return (data ?? []) as Project[];
}

export async function createProject(
  client: SupabaseClient,
  input: CreateProjectInput
): Promise<Project> {
  const { data, error } = await client
    .from("projects")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    throw new RepositoryError(`Failed to create project: ${error.message}`);
  }
  return data as Project;
}

export async function updateProject(
  client: SupabaseClient,
  projectId: string,
  input: UpdateProjectInput
): Promise<Project> {
  const { data, error } = await client
    .from("projects")
    .update(input)
    .eq("id", projectId)
    .select("*")
    .single();

  if (error) {
    throw new RepositoryError(`Failed to update project: ${error.message}`);
  }
  return data as Project;
}

/**
 * Look up a project by slug, creating it if it does not exist.
 *
 * Concurrency: two hooks from two agents can race here on the very first
 * event for a new repo. Rather than lock, we let the unique index on
 * (workspace_id, slug) arbitrate and re-read on conflict — the loser of the
 * race gets the winner's row, which is exactly what it wanted.
 */
export async function ensureProject(
  client: SupabaseClient,
  input: CreateProjectInput
): Promise<Project> {
  const existing = await getProjectBySlug(client, input.workspace_id, input.slug);
  if (existing) return existing;

  const { data, error } = await client
    .from("projects")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    // 23505 = unique_violation: someone else created it between our read and
    // our write. Their row is as good as ours.
    if (error.code === "23505") {
      const raced = await getProjectBySlug(client, input.workspace_id, input.slug);
      if (raced) return raced;
    }
    throw new RepositoryError(`Failed to ensure project: ${error.message}`);
  }
  return data as Project;
}

/** Bump the denormalised session counter. Never fails the caller. */
export async function incrementProjectSessionCount(
  client: SupabaseClient,
  projectId: string
): Promise<void> {
  const { data } = await client
    .from("projects")
    .select("session_count")
    .eq("id", projectId)
    .maybeSingle();

  const current = (data as { session_count: number } | null)?.session_count ?? 0;

  await client
    .from("projects")
    .update({ session_count: current + 1, last_active_at: new Date().toISOString() })
    .eq("id", projectId);
}
