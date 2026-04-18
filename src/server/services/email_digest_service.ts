import { type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { type AuditEvent } from "@/server/domain/types/audit_event";

/**
 * Email digest service.
 *
 * Aggregates recent activity across a user's workspaces and delivers a
 * single summary email on a daily or weekly cadence, according to the
 * user's `user_notification_preferences.email_digest` setting.
 *
 * The user's per-workspace boolean preferences (note_created,
 * note_updated, link_created, branch_promoted, member_joined,
 * proposal_submitted) also gate which audit events are considered —
 * the digest only mentions categories the user has opted in to, so we
 * don't re-surface noise they already muted in the feed.
 *
 * Delivery uses Resend's HTTP API via native fetch (no SDK dep). When
 * `RESEND_API_KEY` is absent the service is a graceful no-op: every
 * eligible user is counted as `skipped` and no network calls happen.
 *
 * This service is invoked by `POST /api/internal/email_digest`, which
 * an external scheduler (Cloudflare Cron, Supabase Scheduled Functions,
 * etc.) pings on the cadence. It is NOT wired to pg_cron.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DigestBatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

type Cadence = "daily" | "weekly";

interface PreferenceRow {
  user_id: string;
  workspace_id: string;
  note_created: boolean;
  note_updated: boolean;
  link_created: boolean;
  branch_promoted: boolean;
  member_joined: boolean;
  proposal_submitted: boolean;
  email_digest: Cadence | "none";
}

interface WorkspaceRow {
  id: string;
  name: string;
}

interface PerWorkspaceSummary {
  workspace_id: string;
  workspace_name: string;
  total: number;
  by_event_type: Map<string, number>;
  notable: AuditEvent[];
}

// ─── Event-type gating ──────────────────────────────────────────────────────

/**
 * Same mapping used by the activity feed service. Kept local so the
 * digest can still compose what's relevant without coupling the two
 * services directly (and so future digest-only categories can diverge).
 */
const PREF_EVENT_MAP: Record<
  keyof Omit<
    PreferenceRow,
    "user_id" | "workspace_id" | "email_digest"
  >,
  string[]
> = {
  note_created: ["note.created"],
  note_updated: ["note.updated"],
  link_created: ["note_link.created"],
  branch_promoted: ["branch.promoted"],
  member_joined: ["member.joined"],
  proposal_submitted: ["write_proposal.created"],
};

function allowedEventTypesFor(prefs: PreferenceRow): string[] {
  const out: string[] = [];
  for (const [key, types] of Object.entries(PREF_EVENT_MAP) as Array<
    [keyof typeof PREF_EVENT_MAP, string[]]
  >) {
    if (prefs[key]) out.push(...types);
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Send the digest batch for the given cadence.
 *
 * Returns counts rather than per-user detail so the cron endpoint stays
 * small and privacy-preserving. Individual failures are logged via pino.
 *
 * Flow:
 *   1. Load preference rows with email_digest = cadence.
 *   2. Group by user_id (a user can belong to many workspaces).
 *   3. For each user, window activity (24h daily / 7d weekly) across
 *      all their subscribed workspaces.
 *   4. Skip users with zero events.
 *   5. Resolve the user's email via the auth admin API and POST to
 *      Resend. Each send is wrapped in try/catch — one failure does
 *      not abort the batch.
 */
export async function sendDigestBatch(
  supabase: SupabaseClient,
  cadence: Cadence
): Promise<DigestBatchResult> {
  const windowHours = cadence === "daily" ? 24 : 24 * 7;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const apiKey = process.env.RESEND_API_KEY;

  const { data: prefRows, error: prefErr } = await supabase
    .from("user_notification_preferences")
    .select(
      "user_id, workspace_id, note_created, note_updated, link_created, branch_promoted, member_joined, proposal_submitted, email_digest"
    )
    .eq("email_digest", cadence);

  if (prefErr) {
    logger.error({ err: prefErr.message, cadence }, "digest_prefs_query_failed");
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const rows = (prefRows ?? []) as PreferenceRow[];
  if (rows.length === 0) {
    logger.info({ cadence }, "digest_no_eligible_users");
    return { sent: 0, skipped: 0, failed: 0 };
  }

  // Group preference rows per user so we can produce one email per user.
  const byUser = new Map<string, PreferenceRow[]>();
  for (const row of rows) {
    const existing = byUser.get(row.user_id);
    if (existing) existing.push(row);
    else byUser.set(row.user_id, [row]);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Key short-circuit: if Resend isn't configured, we still want to
  // iterate so our metrics reflect how many users *would* have been
  // eligible — just skip the actual send.
  if (!apiKey) {
    logger.warn({ cadence, users: byUser.size }, "digest_no_resend_api_key");
  }

  for (const [userId, userPrefs] of byUser) {
    try {
      const summaries = await buildUserSummaries(supabase, userPrefs, since);
      const total = summaries.reduce((sum, s) => sum + s.total, 0);
      if (total === 0) {
        skipped++;
        continue;
      }

      if (!apiKey) {
        // No-op path: we counted them as skipped because we did not
        // actually deliver. The batch result stays consistent regardless
        // of whether the key is set.
        skipped++;
        continue;
      }

      const email = await resolveUserEmail(supabase, userId);
      if (!email) {
        logger.warn({ user_id: userId, cadence }, "digest_user_email_unresolved");
        skipped++;
        continue;
      }

      await sendDigestEmail(apiKey, email, cadence, summaries);
      sent++;
    } catch (err) {
      failed++;
      logger.error(
        {
          user_id: userId,
          cadence,
          err: err instanceof Error ? err.message : String(err),
        },
        "digest_user_send_failed"
      );
    }
  }

  logger.info({ cadence, sent, skipped, failed }, "digest_batch_complete");
  return { sent, skipped, failed };
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function buildUserSummaries(
  supabase: SupabaseClient,
  userPrefs: PreferenceRow[],
  since: string
): Promise<PerWorkspaceSummary[]> {
  const workspaceIds = userPrefs.map((p) => p.workspace_id);
  if (workspaceIds.length === 0) return [];

  // Resolve workspace display names so the email reads nicely.
  const { data: wsData } = await supabase
    .from("workspaces")
    .select("id, name")
    .in("id", workspaceIds);
  const nameById = new Map<string, string>();
  for (const ws of (wsData ?? []) as WorkspaceRow[]) nameById.set(ws.id, ws.name);

  const summaries: PerWorkspaceSummary[] = [];

  for (const prefs of userPrefs) {
    const eventTypes = allowedEventTypesFor(prefs);
    if (eventTypes.length === 0) continue;

    const { data: events } = await supabase
      .from("audit_events")
      .select("*")
      .eq("workspace_id", prefs.workspace_id)
      .neq("actor_id", prefs.user_id)
      .in("event_type", eventTypes)
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);

    const list = (events ?? []) as AuditEvent[];
    if (list.length === 0) continue;

    const byEventType = new Map<string, number>();
    for (const e of list) {
      byEventType.set(e.event_type, (byEventType.get(e.event_type) ?? 0) + 1);
    }

    summaries.push({
      workspace_id: prefs.workspace_id,
      workspace_name: nameById.get(prefs.workspace_id) ?? "Workspace",
      total: list.length,
      by_event_type: byEventType,
      notable: list.slice(0, 5),
    });
  }

  return summaries;
}

async function resolveUserEmail(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  // The admin client exposes auth.admin — not present on a plain cookie
  // client. The caller is responsible for passing an admin Supabase.
  const adminAuth = (
    supabase as unknown as {
      auth: { admin?: { getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } }> } };
    }
  ).auth.admin;
  if (!adminAuth) return null;

  const { data } = await adminAuth.getUserById(userId);
  return data.user?.email ?? null;
}

// Human-readable label for event types used in the digest.
const EVENT_LABELS: Record<string, string> = {
  "note.created": "New notes",
  "note.updated": "Note updates",
  "note_link.created": "New links",
  "branch.promoted": "Branches promoted",
  "member.joined": "New members",
  "write_proposal.created": "New proposals",
};

function labelFor(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType;
}

function notableSummary(event: AuditEvent): string {
  const md = event.metadata ?? {};
  const title =
    (md.title as string | undefined) ??
    (md.name as string | undefined) ??
    (md.object_name as string | undefined) ??
    event.object_id;
  return `${labelFor(event.event_type)}: ${title}`;
}

/** Minimal HTML escape for values interpolated into the email template. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml(
  cadence: Cadence,
  summaries: PerWorkspaceSummary[]
): { subject: string; html: string; text: string } {
  const period = cadence === "daily" ? "day" : "week";
  const totalEvents = summaries.reduce((sum, s) => sum + s.total, 0);
  const subject = `Your Context Store ${cadence} digest — ${totalEvents} update${
    totalEvents === 1 ? "" : "s"
  }`;

  const workspaceSections = summaries
    .map((s) => {
      const rows = [...s.by_event_type.entries()]
        .map(
          ([ev, count]) =>
            `<li style="margin:0 0 4px;font-size:14px;color:#333;">${escapeHtml(
              labelFor(ev)
            )}: <strong>${count}</strong></li>`
        )
        .join("");
      const notable = s.notable
        .map(
          (e) =>
            `<li style="margin:0 0 4px;font-size:13px;color:#555;">${escapeHtml(
              notableSummary(e)
            )}</li>`
        )
        .join("");
      return `
        <tr><td style="padding:12px 0 4px;border-top:1px solid #eee;">
          <h2 style="margin:0 0 8px;font-size:16px;font-weight:600;">${escapeHtml(
            s.workspace_name
          )}</h2>
          <ul style="margin:0 0 8px;padding-left:18px;">${rows}</ul>
          ${
            notable
              ? `<p style="margin:4px 0 4px;font-size:12px;color:#777;">Notable:</p><ul style="margin:0 0 8px;padding-left:18px;">${notable}</ul>`
              : ""
          }
        </td></tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td>
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;">Your ${escapeHtml(
            cadence
          )} digest</h1>
          <p style="margin:0 0 16px;font-size:14px;color:#555;">Here's what happened in your workspaces over the last ${period}.</p>
        </td></tr>
        ${workspaceSections}
        <tr><td style="padding:16px 0 0;border-top:1px solid #eee;">
          <p style="margin:0;font-size:12px;color:#888;">You can change the cadence or turn this off in your notification preferences.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const textLines = [
    `Your ${cadence} Context Store digest`,
    ``,
    ...summaries.flatMap((s) => {
      const header = `${s.workspace_name} (${s.total})`;
      const counts = [...s.by_event_type.entries()].map(
        ([ev, count]) => `  - ${labelFor(ev)}: ${count}`
      );
      const notable = s.notable.map((e) => `    * ${notableSummary(e)}`);
      return [header, ...counts, ...notable, ``];
    }),
  ];
  const text = textLines.join("\n");

  return { subject, html, text };
}

async function sendDigestEmail(
  apiKey: string,
  email: string,
  cadence: Cadence,
  summaries: PerWorkspaceSummary[]
): Promise<void> {
  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? "mail.contextstore.dev";
  const { subject, html, text } = buildEmailHtml(cadence, summaries);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Context Store <digest@${fromDomain}>`,
      to: [email],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `resend responded ${res.status}: ${body.slice(0, 300)}`
    );
  }
}
