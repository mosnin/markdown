import { type WorkspaceRole } from "@/server/domain/types/workspace";
import { requireAuthenticatedUser } from "./require_authenticated_user";

/**
 * Workspace role guards.
 *
 * The three-role access model (viewer / member / admin) is enforced at
 * the service / server-action layer. Every mutation that touches
 * workspace-scoped content must go through one of these guards so viewer
 * accounts cannot write through any path — client-hidden controls, API
 * routes, or MCP adapters included.
 *
 * RLS at the database level remains keyed to workspace_memberships (any
 * role grants row access) so reads don't need per-role gates. Write gating
 * lives here so the application has a single, auditable seam.
 */

/** Returns true if `role` is authorized to perform a write. */
export function canWrite(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

/** Returns true if `role` is authorized to manage membership / settings. */
export function canAdmin(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Server-action guard: ensures the caller holds a write-capable role on
 * their active workspace. Throws if the caller is a viewer (or otherwise
 * not writable). Callers that want to return an ActionResult instead of
 * throwing should use `requireWriteResult` below.
 */
export async function requireWriteRole() {
  const ctx = await requireAuthenticatedUser();
  if (!canWrite(ctx.workspace.role)) {
    throw new Error("Viewers cannot perform write actions in this workspace.");
  }
  return ctx;
}

/**
 * Same as `requireWriteRole` but returns a tagged union so callers can
 * surface the error as a friendly ActionResult without a try/catch.
 */
export async function requireWriteRoleResult(): Promise<
  | { ok: true; ctx: Awaited<ReturnType<typeof requireAuthenticatedUser>> }
  | { ok: false; error: string }
> {
  const ctx = await requireAuthenticatedUser();
  if (!canWrite(ctx.workspace.role)) {
    return {
      ok: false,
      error: "You have view-only access to this workspace.",
    };
  }
  return { ok: true, ctx };
}

/** Server-action guard: admin-only operations (member management, etc.). */
export async function requireAdminRole() {
  const ctx = await requireAuthenticatedUser();
  if (!canAdmin(ctx.workspace.role)) {
    throw new Error("Admin access required.");
  }
  return ctx;
}

export async function requireAdminRoleResult(): Promise<
  | { ok: true; ctx: Awaited<ReturnType<typeof requireAuthenticatedUser>> }
  | { ok: false; error: string }
> {
  const ctx = await requireAuthenticatedUser();
  if (!canAdmin(ctx.workspace.role)) {
    return {
      ok: false,
      error: "Only admins can perform this action.",
    };
  }
  return { ok: true, ctx };
}
