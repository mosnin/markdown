"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import { updateWorkspace } from "@/server/repositories/workspace_repository";

// ─── Action result ────────────────────────────────────────────────────────────

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return { supabase, workspaceId: ctx.workspace.id };
}

// ─── Update profile ───────────────────────────────────────────────────────────

export async function updateProfileAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    const { supabase } = await requireContext();

    const displayName = (formData.get("display_name") as string | null)?.trim() ?? "";

    const { error } = await supabase.auth.updateUser({
      data: { full_name: displayName },
    });

    if (error) throw error;

    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update profile",
    };
  }
}

// ─── Change password ──────────────────────────────────────────────────────────

export type ChangePasswordState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const newPassword = formData.get("newPassword") as string | null;
  const confirmPassword = formData.get("confirmPassword") as string | null;

  if (!newPassword || !confirmPassword) {
    return { status: "error", message: "Both password fields are required." };
  }

  if (newPassword.length < 8) {
    return {
      status: "error",
      message: "New password must be at least 8 characters.",
    };
  }

  if (newPassword !== confirmPassword) {
    return { status: "error", message: "Passwords do not match." };
  }

  try {
    const { supabase } = await requireContext();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      return {
        status: "error",
        message: error.message ?? "Could not update password. Please try again.",
      };
    }
  } catch {
    return { status: "error", message: "Could not update password. Please try again." };
  }

  return { status: "success" };
}

// ─── Update theme ─────────────────────────────────────────────────────────────

export type Theme = "light" | "dark" | "system";

export async function updateThemeAction(
  theme: Theme
): Promise<ActionResult> {
  try {
    const { supabase } = await requireContext();

    const { error } = await supabase.auth.updateUser({
      data: { theme },
    });

    if (error) throw error;

    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update theme",
    };
  }
}

// ─── Update notifications ─────────────────────────────────────────────────────

export interface NotificationPreferences {
  activity: boolean;
  security: boolean;
  announcements: boolean;
}

export async function updateNotificationsAction(
  prefs: NotificationPreferences
): Promise<ActionResult> {
  try {
    const { supabase } = await requireContext();

    const { error } = await supabase.auth.updateUser({
      data: { notifications: prefs },
    });

    if (error) throw error;

    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save notification preferences",
    };
  }
}

// ─── Update workspace ─────────────────────────────────────────────────────────

export async function updateWorkspaceAction(
  formData: FormData
): Promise<ActionResult> {
  try {
    const { supabase, workspaceId } = await requireContext();

    const name = (formData.get("name") as string | null)?.trim();
    const description = (formData.get("description") as string | null)?.trim() || null;

    if (!name) throw new Error("Workspace name is required");

    const updated = await updateWorkspace(supabase, workspaceId, { name, description });
    if (!updated) throw new Error("Failed to update workspace");

    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update workspace",
    };
  }
}
