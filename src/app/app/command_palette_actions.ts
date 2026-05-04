"use server";

/**
 * Server actions that power the Cmd+K command palette (Phase 7D).
 *
 * The palette surfaces three context-sensitive data sources:
 *
 *   1. Recent notes for the workspace ("Recent notes" group).
 *   2. Sub-agent-enabled skills, optionally filtered by the user's query
 *      ("Sub-agents" group).
 *   3. Entities from the knowledge graph matching the query
 *      ("Entities" group) — reuses the Phase 1 ilike search.
 *
 * All three actions go through `requireAuthenticatedUser` and scope every
 * lookup to the caller's active workspace so nothing leaks across tenants.
 * They return a typed discriminated union so the client can trivially
 * distinguish success/failure without try/catch.
 *
 * The note-listing action does not live in `notes/actions.ts` because it
 * returns a narrowly-projected row shape tuned for the palette (no heavy
 * markdown) and the palette group is an orthogonal consumer that should
 * not drag in the full notes-action surface.
 */

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────

export interface PaletteNote {
  id: string;
  title: string;
  box_id: string;
  updated_at: string;
}

export interface PaletteSubagentSkill {
  id: string;
  name: string;
  description: string | null;
}

export interface PaletteEntity {
  id: string;
  name: string;
  entity_type: string;
}

export interface PaletteBox {
  id: string;
  name: string;
  slug: string;
}

export interface PaletteAgent {
  id: string;
  name: string;
  description: string | null;
}

export interface PaletteBranch {
  id: string;
  name: string;
  status: string;
}

export interface PaletteWorkspace {
  id: string;
  name: string;
  slug: string;
}

export type PaletteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Actions ──────────────────────────────────────────────────────────────

/**
 * List up to `limit` most-recently-updated notes in the caller's workspace.
 *
 * `notes` has no `workspace_id` column — ownership is inferred via the
 * containing box. We use an embedded `boxes!inner(workspace_id)` join so
 * Supabase can push the workspace filter into the database. Trashed notes
 * are excluded via the `status` check (the table uses a status enum, not
 * a `deleted_at` timestamp).
 */
export async function listRecentNotesForPaletteAction(
  limit = 10
): Promise<PaletteResult<PaletteNote[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));

    const { data, error } = await supabase
      .from("notes")
      .select("id, title, box_id, updated_at, boxes!inner(workspace_id)")
      .eq("boxes.workspace_id", ctx.workspace.id)
      .neq("status", "trashed")
      .is("branch_id", null)
      .order("updated_at", { ascending: false })
      .limit(safeLimit);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      box_id: string;
      updated_at: string;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        box_id: r.box_id,
        updated_at: r.updated_at,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load recent notes",
    };
  }
}

/**
 * List sub-agent-enabled skills in the caller's workspace, optionally
 * narrowed by a case-insensitive name match.
 *
 * These are the same skills surfaced by `list_skills_plugins` to the
 * orchestrator — the palette exposes them so users can jump straight to a
 * sub-agent's editor without digging through the skills tree.
 */
export async function listSubagentSkillsForPaletteAction(
  query?: string
): Promise<PaletteResult<PaletteSubagentSkill[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    let builder = supabase
      .from("skills")
      .select("id, name, description")
      .eq("workspace_id", ctx.workspace.id)
      .eq("is_subagent", true)
      .neq("status", "trashed");

    const trimmed = query?.trim();
    if (trimmed) {
      builder = builder.ilike("name", `%${trimmed}%`);
    }

    const { data, error } = await builder
      .order("updated_at", { ascending: false })
      .limit(12);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load sub-agents",
    };
  }
}

/**
 * Search entities by name for the palette. Mirrors the behaviour of
 * `searchEntitiesAction` but returns a projected shape the palette can
 * render directly without pulling in the full EntitySearchHit type.
 *
 * Short-circuits on empty queries so the palette doesn't burn a round
 * trip on every initial open.
 */
export async function searchEntitiesForPaletteAction(
  query: string,
  limit = 8
): Promise<PaletteResult<PaletteEntity[]>> {
  try {
    const trimmed = query.trim();
    if (!trimmed) return { ok: true, data: [] };

    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));

    const { data, error } = await supabase
      .from("entities")
      .select("id, name, entity_type, mention_count")
      .eq("workspace_id", ctx.workspace.id)
      .ilike("name", `%${trimmed}%`)
      .order("mention_count", { ascending: false })
      .limit(safeLimit);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      entity_type: string;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        entity_type: r.entity_type,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to search entities",
    };
  }
}

/**
 * List boxes in the active workspace, optionally narrowed by a name match.
 *
 * Powers the "Open box…" typeahead and the deep-link sub-actions. Excludes
 * trashed and archived boxes so the picker shows only what the user can
 * realistically land on.
 */
export async function listBoxesForPaletteAction(
  query?: string
): Promise<PaletteResult<PaletteBox[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    let builder = supabase
      .from("boxes")
      .select("id, name, slug, status")
      .eq("workspace_id", ctx.workspace.id)
      .neq("status", "trashed")
      .neq("status", "archived");

    const trimmed = query?.trim();
    if (trimmed) {
      builder = builder.ilike("name", `%${trimmed}%`);
    }

    const { data, error } = await builder
      .order("name", { ascending: true })
      .limit(20);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load boxes",
    };
  }
}

/**
 * Search notes by title across the active workspace. Only used when the
 * user is typing — empty queries short-circuit to keep the recent-notes
 * group as the default surface.
 */
export async function searchNotesForPaletteAction(
  query: string,
  limit = 10
): Promise<PaletteResult<PaletteNote[]>> {
  try {
    const trimmed = query.trim();
    if (!trimmed) return { ok: true, data: [] };

    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));

    const { data, error } = await supabase
      .from("notes")
      .select("id, title, box_id, updated_at, boxes!inner(workspace_id)")
      .eq("boxes.workspace_id", ctx.workspace.id)
      .neq("status", "trashed")
      .ilike("title", `%${trimmed}%`)
      .order("updated_at", { ascending: false })
      .limit(safeLimit);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      box_id: string;
      updated_at: string;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        box_id: r.box_id,
        updated_at: r.updated_at,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to search notes",
    };
  }
}

/**
 * List reusable agents in the active workspace, optionally narrowed by
 * a name match. Powers the "Run agent on…" typeahead so the operator
 * panel can be primed with the chosen agent.
 */
export async function listAgentsForPaletteAction(
  query?: string
): Promise<PaletteResult<PaletteAgent[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    let builder = supabase
      .from("agents")
      .select("id, name, description")
      .eq("workspace_id", ctx.workspace.id)
      .eq("is_reusable", true)
      .neq("status", "trashed");

    const trimmed = query?.trim();
    if (trimmed) {
      builder = builder.ilike("name", `%${trimmed}%`);
    }

    const { data, error } = await builder
      .order("name", { ascending: true })
      .limit(15);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load agents",
    };
  }
}

/**
 * List active draft branches in the workspace. Used for the "Promote
 * branch" typeahead when no branch is in the current context.
 */
export async function listBranchesForPaletteAction(
  query?: string
): Promise<PaletteResult<PaletteBranch[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    let builder = supabase
      .from("draft_branches")
      .select("id, name, status")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "open");

    const trimmed = query?.trim();
    if (trimmed) {
      builder = builder.ilike("name", `%${trimmed}%`);
    }

    const { data, error } = await builder
      .order("created_at", { ascending: false })
      .limit(15);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      status: string;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({ id: r.id, name: r.name, status: r.status })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load branches",
    };
  }
}

/**
 * List workspaces the current user owns so the palette can offer a
 * "Switch workspace…" action without re-fetching from a parent layout.
 */
export async function listWorkspacesForPaletteAction(): Promise<
  PaletteResult<PaletteWorkspace[]>
> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name, slug, status")
      .eq("owner_id", ctx.user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
    }>;

    return {
      ok: true,
      data: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load workspaces",
    };
  }
}
