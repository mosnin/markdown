"use server";

import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  getActivityFeed,
  getUnreadCount,
  markAsRead,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/server/services/activity_feed_service";

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireContext() {
  const ctx = await getRequestContext();
  if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
    throw new Error("Unauthenticated");
  }
  const supabase = await createClient();
  return { supabase, userId: ctx.user.id, workspaceId: ctx.workspace.id };
}

// ─── Result type ────────────────────────────────────────────────────────────

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Feed actions ───────────────────────────────────────────────────────────

export async function getActivityFeedAction(
  before?: string
): Promise<
  ActionResult<{
    items: Awaited<ReturnType<typeof getActivityFeed>>["items"];
    has_more: boolean;
  }>
> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const result = await getActivityFeed(supabase, workspaceId, userId, {
      limit: 30,
      before,
    });
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load activity feed",
    };
  }
}

export async function markFeedAsReadAction(): Promise<ActionResult> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    await markAsRead(supabase, workspaceId, userId);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark feed as read",
    };
  }
}

export async function getUnreadCountAction(): Promise<ActionResult<number>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const count = await getUnreadCount(supabase, workspaceId, userId);
    return { ok: true, data: count };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to get unread count",
    };
  }
}

export async function updateNotificationPreferencesAction(
  patch: Partial<
    Pick<
      NotificationPreferences,
      | "note_created"
      | "note_updated"
      | "link_created"
      | "branch_promoted"
      | "member_joined"
      | "proposal_submitted"
      | "email_digest"
    >
  >
): Promise<ActionResult<NotificationPreferences>> {
  try {
    const { supabase, userId, workspaceId } = await requireContext();
    const result = await updateNotificationPreferences(
      supabase,
      userId,
      workspaceId,
      patch
    );
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update notification preferences",
    };
  }
}
