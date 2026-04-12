"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext, ACTIVE_WORKSPACE_COOKIE } from "@/server/auth/get_request_context";
import {
  createWorkspace,
  listWorkspacesByOwner,
} from "@/server/repositories/workspace_repository";
import { listAccessibleWorkspaces } from "@/server/repositories/workspace_membership_repository";
import { slugify } from "@/lib/slugify";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Create a new workspace owned by the current user.
 *
 * Workspaces are multi-workspace capable: a user may own any number.
 * The newly created workspace becomes the active workspace for the
 * session (the active_workspace_id cookie is set), so subsequent page
 * loads render the new workspace by default. The sidebar and every
 * page that uses `getRequestContext().workspace` will read the new
 * workspace on the next render.
 */
export async function createWorkspaceAction(
  name: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Workspace name is required" };
    if (trimmed.length > 120) {
      return { ok: false, error: "Workspace name must be 120 characters or fewer" };
    }

    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Not authenticated" };
    }

    const supabase = await createClient();
    const existing = await listWorkspacesByOwner(supabase, ctx.user.id);
    const base = slugify(trimmed) || "workspace";

    // Ensure slug uniqueness per owner
    const existingSlugs = new Set(existing.map((w) => w.slug));
    let slug = base;
    let suffix = 2;
    while (existingSlugs.has(slug)) {
      slug = `${base}-${suffix++}`;
    }

    const workspace = await createWorkspace(supabase, {
      owner_id: ctx.user.id,
      name: trimmed,
      slug,
    });

    // Make this the active workspace so the user lands on it immediately.
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspace.id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    // Revalidate the app shell and the workspaces page so the new
    // workspace appears in the switcher and is rendered by all downstream
    // pages on the next navigation.
    revalidatePath("/app", "layout");

    return { ok: true, data: { id: workspace.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create workspace" };
  }
}

/**
 * Set the active workspace for the current user.
 *
 * Writes the `active_workspace_id` cookie. All subsequent server renders
 * call `getRequestContext()` which reads the cookie and loads the matching
 * workspace (falling back to the first owned workspace if the id no
 * longer matches, to guarantee the app never renders in a broken state).
 *
 * Only the owner of the workspace can activate it — the server-side
 * listWorkspacesByOwner call gates the switch.
 */
export async function setActiveWorkspaceAction(
  workspaceId: string,
): Promise<ActionResult> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Not authenticated" };
    }

    const supabase = await createClient();
    // Accept any workspace the user has membership in — not just ones they
    // own — so members and viewers can also set an invited workspace as
    // their active selection.
    const accessible = await listAccessibleWorkspaces(supabase, ctx.user.id);
    if (!accessible.some((w) => w.id === workspaceId)) {
      return { ok: false, error: "Workspace not found" };
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    revalidatePath("/app", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to switch workspace" };
  }
}

/** Sever action form target that switches workspace and redirects to /app. */
export async function switchWorkspaceAndNavigate(
  formData: FormData,
): Promise<void> {
  const workspaceId = formData.get("workspace_id");
  if (typeof workspaceId !== "string") return;
  const result = await setActiveWorkspaceAction(workspaceId);
  if (result.ok) redirect("/app");
}
