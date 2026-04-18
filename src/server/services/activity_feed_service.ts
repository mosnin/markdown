import { type SupabaseClient } from "@supabase/supabase-js";
import { type AuditEvent } from "@/server/domain/types/audit_event";

/**
 * Activity feed service.
 *
 * Provides a personalized activity stream for a workspace member by
 * querying audit_events filtered through the user's notification
 * preferences. Own actions are excluded so the feed only shows
 * "what happened while I was away."
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  user_id: string;
  workspace_id: string;
  note_created: boolean;
  note_updated: boolean;
  link_created: boolean;
  branch_promoted: boolean;
  member_joined: boolean;
  proposal_submitted: boolean;
  email_digest: "none" | "daily" | "weekly";
  updated_at: string;
}

export interface FeedItem {
  id: string;
  workspace_id: string;
  actor_id: string;
  actor_display_name: string;
  object_type: string;
  object_id: string;
  object_display_name: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface FeedResult {
  items: FeedItem[];
  has_more: boolean;
}

// ─── Preference-to-event-type mapping ───────────────────────────────────────

/**
 * Maps notification preference keys to event_type prefixes. When a
 * preference is enabled the corresponding event types are included
 * in the feed query.
 */
const PREF_EVENT_MAP: Record<string, string[]> = {
  note_created: ["note.created"],
  note_updated: ["note.updated"],
  link_created: ["note_link.created"],
  branch_promoted: ["branch.promoted"],
  member_joined: ["member.joined"],
  proposal_submitted: ["write_proposal.created"],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildAllowedEventTypes(prefs: NotificationPreferences): string[] {
  const allowed: string[] = [];
  for (const [key, eventTypes] of Object.entries(PREF_EVENT_MAP)) {
    if (prefs[key as keyof NotificationPreferences] === true) {
      allowed.push(...eventTypes);
    }
  }
  return allowed;
}

function extractDisplayName(event: AuditEvent): string {
  const md = event.metadata;
  if (!md) return event.object_id;
  return (
    (md.title as string) ??
    (md.name as string) ??
    (md.object_name as string) ??
    event.object_id
  );
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch the personalized activity feed for a user.
 *
 * - Filters events by the user's notification preferences.
 * - Excludes the user's own actions.
 * - Supports cursor-based pagination via `before` (ISO timestamp).
 */
export async function getActivityFeed(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<FeedResult> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const prefs = await getNotificationPreferences(supabase, userId, workspaceId);
  const allowedEventTypes = buildAllowedEventTypes(prefs);

  if (allowedEventTypes.length === 0) {
    return { items: [], has_more: false };
  }

  let query = supabase
    .from("audit_events")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("actor_id", userId)
    .in("event_type", allowedEventTypes)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (opts.before) {
    query = query.lt("created_at", opts.before);
  }

  const { data, error } = await query;

  if (error || !data) {
    return { items: [], has_more: false };
  }

  const events = data as AuditEvent[];
  const has_more = events.length > limit;
  const page = has_more ? events.slice(0, limit) : events;

  const items: FeedItem[] = page.map((e) => ({
    id: e.id,
    workspace_id: e.workspace_id,
    actor_id: e.actor_id,
    actor_display_name: e.actor_id,
    object_type: e.object_type,
    object_id: e.object_id,
    object_display_name: extractDisplayName(e),
    event_type: e.event_type,
    metadata: e.metadata,
    created_at: e.created_at,
  }));

  return { items, has_more };
}

/**
 * Count unread feed events since the user's last read cursor.
 */
export async function getUnreadCount(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<number> {
  // Get the read cursor
  const { data: cursor } = await supabase
    .from("user_feed_read_cursors")
    .select("last_read_at")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const lastReadAt = cursor?.last_read_at ?? "1970-01-01T00:00:00Z";

  // Get preferences to know which event types to count
  const prefs = await getNotificationPreferences(supabase, userId, workspaceId);
  const allowedEventTypes = buildAllowedEventTypes(prefs);

  if (allowedEventTypes.length === 0) return 0;

  const { count, error } = await supabase
    .from("audit_events")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("actor_id", userId)
    .in("event_type", allowedEventTypes)
    .gt("created_at", lastReadAt);

  if (error) return 0;
  return count ?? 0;
}

/**
 * Mark the feed as read by advancing the cursor to now().
 */
export async function markAsRead(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();

  await supabase
    .from("user_feed_read_cursors")
    .upsert(
      { user_id: userId, workspace_id: workspaceId, last_read_at: now },
      { onConflict: "user_id,workspace_id" }
    );
}

/**
 * Get notification preferences. Returns defaults if no row exists yet.
 */
export async function getNotificationPreferences(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string
): Promise<NotificationPreferences> {
  const { data } = await supabase
    .from("user_notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (data) return data as NotificationPreferences;

  // Return defaults when no row exists
  return {
    user_id: userId,
    workspace_id: workspaceId,
    note_created: true,
    note_updated: false,
    link_created: true,
    branch_promoted: true,
    member_joined: true,
    proposal_submitted: true,
    email_digest: "none",
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update notification preferences. Upserts the row.
 */
export async function updateNotificationPreferences(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
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
): Promise<NotificationPreferences> {
  const { data: existing } = await supabase
    .from("user_notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("user_notification_preferences")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error || !data) throw new Error(error?.message ?? "Failed to update preferences");
    return data as NotificationPreferences;
  }

  // Insert new row with defaults + patch
  const defaults: Omit<NotificationPreferences, "updated_at"> = {
    user_id: userId,
    workspace_id: workspaceId,
    note_created: true,
    note_updated: false,
    link_created: true,
    branch_promoted: true,
    member_joined: true,
    proposal_submitted: true,
    email_digest: "none",
  };

  const { data, error } = await supabase
    .from("user_notification_preferences")
    .insert({ ...defaults, ...patch, updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create preferences");
  return data as NotificationPreferences;
}
