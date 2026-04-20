import { type SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";

/**
 * Operator notification preferences + delivery.
 *
 * Two responsibilities live here:
 *
 *   1. Read/write `public.operator_notification_preferences` rows. The
 *      preference is per-user (not per-workspace) so the user gets a
 *      single consistent inbox experience across workspaces.
 *
 *   2. Send (or log) a "your run is done" / "your run failed" email.
 *      Reuses the same Resend HTTP transport pattern the existing
 *      email_digest_service.ts uses — no new SDK dependency. When
 *      `RESEND_API_KEY` is unset (local dev, fork builds), the send
 *      path becomes a structured log entry tagged
 *      `operator_notification_skipped_no_api_key`.
 *
 * Idempotency: this service does NOT track "already-sent" state. If
 * called twice for the same run, two emails go out. The caller is
 * expected to invoke notify* exactly once per run terminal transition
 * (e.g. from the server action that finalises the run row). Wave 1
 * deliberately scoped this to "best effort" — adding a per-row
 * `notified_at` column would require touching workspace_operator_runs,
 * which belongs to Agent F. See the Wave 2 integration note in the
 * agent report.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OperatorNotificationPrefs {
  emailOnComplete: boolean;
  emailOnFail: boolean;
  /**
   * Fires when a plan-mode run transitions to `awaiting_approval`. Added in
   * 20260420000006 to close Operator gap #5 (binary-only notifications).
   */
  emailOnApprovalNeeded: boolean;
  /** Fires when a run is cancelled (see cancelRunAction). */
  emailOnCancel: boolean;
  /**
   * Reserved for future daily/weekly digest wiring. Surfaced on the type so
   * the settings UI can round-trip it; not consumed by any notify* path yet.
   */
  digestEnabled: boolean;
}

export interface SetOperatorNotificationPatch {
  emailOnComplete?: boolean;
  emailOnFail?: boolean;
  emailOnApprovalNeeded?: boolean;
  emailOnCancel?: boolean;
  digestEnabled?: boolean;
}

/**
 * Reason discriminator for non-send results. Extended in gap #5 with
 * "disabled" so granular-opt-in call sites (approval / cancel) can return a
 * consistent shape even though the read layer historically used
 * "no_prefs_opt_in". New call sites should prefer "disabled"; the legacy
 * "no_prefs_opt_in" is kept for back-compat with the complete/fail paths
 * and their snapshot tests.
 */
export type NotifyResult =
  | { sent: true; channel: "email" }
  | {
      sent: false;
      reason:
        | "no_prefs_opt_in"
        | "disabled"
        | "no_run"
        | "no_email"
        | "no_api_key"
        | "send_failed";
      error?: string;
    };

// ─── Defaults ───────────────────────────────────────────────────────────────

/**
 * Defaults applied when the user has no row yet. Mirrors the column
 * defaults in 20260420000003 — failure notifications default ON,
 * completion notifications default OFF (least surprise: tell me when
 * something goes wrong, don't spam me on every happy path).
 */
const DEFAULT_PREFS: OperatorNotificationPrefs = {
  emailOnComplete: false,
  emailOnFail: true,
  // New granular opt-ins default OFF — symmetric with email_on_complete and
  // consistent with the "don't surprise the user with more mail" stance.
  emailOnApprovalNeeded: false,
  emailOnCancel: false,
  digestEnabled: false,
};

interface PrefsRow {
  user_id: string;
  email_on_complete: boolean;
  email_on_fail: boolean;
  // Nullable on the row-read path so older DBs that predate 20260420000006
  // (or a row seeded before the migration landed) don't crash the select —
  // we coerce to the default when the field is missing/undefined.
  email_on_approval_needed?: boolean | null;
  email_on_cancel?: boolean | null;
  digest_enabled?: boolean | null;
  updated_at: string;
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * Read the user's preference row, returning the system defaults when no
 * row exists. Never throws on "row missing" — the caller can always
 * trust the returned shape.
 */
export async function getNotificationPrefs(
  supabase: SupabaseClient,
  userId: string
): Promise<OperatorNotificationPrefs> {
  const { data, error } = await supabase
    .from("operator_notification_preferences")
    .select(
      "user_id, email_on_complete, email_on_fail, email_on_approval_needed, email_on_cancel, digest_enabled, updated_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // Table missing / RLS denied / network blip — log and fall back to
    // defaults. Notification prefs are not load-bearing; we'd rather
    // accidentally email a user once on the failure path than block
    // a run finalisation on a flaky read.
    logger.warn(
      { err: error.message, user_id: userId },
      "operator_notification_prefs_read_failed"
    );
    return { ...DEFAULT_PREFS };
  }

  if (!data) return { ...DEFAULT_PREFS };

  const row = data as PrefsRow;
  return {
    emailOnComplete: row.email_on_complete,
    emailOnFail: row.email_on_fail,
    emailOnApprovalNeeded: row.email_on_approval_needed ?? false,
    emailOnCancel: row.email_on_cancel ?? false,
    digestEnabled: row.digest_enabled ?? false,
  };
}

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Upsert the user's preference row. Only the fields supplied in `patch`
 * are written; missing fields keep their current value (or the default
 * if no row exists yet).
 */
export async function setNotificationPrefs(
  supabase: SupabaseClient,
  userId: string,
  patch: SetOperatorNotificationPatch
): Promise<OperatorNotificationPrefs> {
  // Compose the next row by overlaying the patch onto whatever exists
  // (or the defaults). This avoids an upsert that would clobber the
  // un-patched field on every call.
  const current = await getNotificationPrefs(supabase, userId);
  const next: OperatorNotificationPrefs = {
    emailOnComplete: patch.emailOnComplete ?? current.emailOnComplete,
    emailOnFail: patch.emailOnFail ?? current.emailOnFail,
    emailOnApprovalNeeded:
      patch.emailOnApprovalNeeded ?? current.emailOnApprovalNeeded,
    emailOnCancel: patch.emailOnCancel ?? current.emailOnCancel,
    digestEnabled: patch.digestEnabled ?? current.digestEnabled,
  };

  const { error } = await supabase
    .from("operator_notification_preferences")
    .upsert(
      {
        user_id: userId,
        email_on_complete: next.emailOnComplete,
        email_on_fail: next.emailOnFail,
        email_on_approval_needed: next.emailOnApprovalNeeded,
        email_on_cancel: next.emailOnCancel,
        digest_enabled: next.digestEnabled,
      },
      { onConflict: "user_id" }
    );

  if (error) {
    throw new Error(
      `Failed to save notification preferences: ${error.message}`
    );
  }
  return next;
}

// ─── Send (the public side of notify*) ──────────────────────────────────────

/**
 * Notify the run's actor that their run completed successfully. No-op
 * if the user has `email_on_complete = false`.
 */
export async function notifyRunCompleted(
  supabase: SupabaseClient,
  runId: string
): Promise<NotifyResult> {
  return notifyForRun(supabase, runId, "completed");
}

/**
 * Notify the run's actor that their run failed. No-op if the user has
 * `email_on_fail = false`.
 */
export async function notifyRunFailed(
  supabase: SupabaseClient,
  runId: string
): Promise<NotifyResult> {
  return notifyForRun(supabase, runId, "failed");
}

/**
 * Notify the run's actor that a plan-mode run is waiting for approval.
 * No-op if the user has `email_on_approval_needed = false`. Same best-effort
 * posture as {@link notifyRunCompleted} — never throws, logs and returns a
 * structured result.
 */
export async function notifyRunAwaitingApproval(
  supabase: SupabaseClient,
  runId: string
): Promise<NotifyResult> {
  return notifyForRun(supabase, runId, "awaiting_approval");
}

/**
 * Notify the run's actor that their run has been cancelled. No-op if the
 * user has `email_on_cancel = false`.
 */
export async function notifyRunCancelled(
  supabase: SupabaseClient,
  runId: string
): Promise<NotifyResult> {
  return notifyForRun(supabase, runId, "cancelled");
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Internal notification dispatcher.
 *
 * Outcomes map 1:1 to preference columns:
 *   completed           → email_on_complete
 *   failed              → email_on_fail
 *   awaiting_approval   → email_on_approval_needed   (gap #5)
 *   cancelled           → email_on_cancel            (gap #5)
 *
 * We keep the "opted out" branch returning `no_prefs_opt_in` for the legacy
 * complete/failed path (existing tests and callers depend on that exact
 * reason string) and return `disabled` for the new outcomes so the wire
 * shape for the granular prefs is unambiguous at the call site.
 */
type NotifyOutcome = "completed" | "failed" | "awaiting_approval" | "cancelled";

function isOutcomeEnabled(
  outcome: NotifyOutcome,
  prefs: OperatorNotificationPrefs
): boolean {
  switch (outcome) {
    case "completed":
      return prefs.emailOnComplete;
    case "failed":
      return prefs.emailOnFail;
    case "awaiting_approval":
      return prefs.emailOnApprovalNeeded;
    case "cancelled":
      return prefs.emailOnCancel;
  }
}

async function notifyForRun(
  supabase: SupabaseClient,
  runId: string,
  outcome: NotifyOutcome
): Promise<NotifyResult> {
  const run = await getOperatorRun(supabase, runId);
  if (!run) return { sent: false, reason: "no_run" };

  const prefs = await getNotificationPrefs(supabase, run.user_id);
  const optedIn = isOutcomeEnabled(outcome, prefs);
  if (!optedIn) {
    // Preserve back-compat on the legacy paths while giving the new outcomes
    // a dedicated reason that the gap-#5 test suite asserts against.
    const reason =
      outcome === "completed" || outcome === "failed"
        ? "no_prefs_opt_in"
        : "disabled";
    return { sent: false, reason };
  }

  const email = await resolveUserEmail(supabase, run.user_id);
  if (!email) {
    logger.warn(
      { user_id: run.user_id, run_id: runId },
      "operator_notification_email_unresolved"
    );
    return { sent: false, reason: "no_email" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Stub path — log structured fields the future PR can grep for and
    // return a non-error result. The caller treats this as "we tried;
    // the infra wasn't configured", not an outright failure.
    logger.info(
      {
        run_id: runId,
        user_id: run.user_id,
        workspace_id: run.workspace_id,
        outcome,
        email,
      },
      "operator_notification_skipped_no_api_key"
    );
    return { sent: false, reason: "no_api_key" };
  }

  try {
    await sendOperatorRunEmail(apiKey, email, {
      outcome,
      runId: run.id,
      workspaceId: run.workspace_id,
      notesCreated: (run.notes_created ?? []).length,
      toolCalls: run.tool_calls ?? 0,
      error: run.error,
      promptPreview: (run.prompt ?? "").slice(0, 200),
    });
    return { sent: true, channel: "email" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { run_id: runId, user_id: run.user_id, err: message },
      "operator_notification_send_failed"
    );
    return { sent: false, reason: "send_failed", error: message };
  }
}

/**
 * Public stub that callers can wire from the server action layer when
 * an email-only path is preferred (no run row required). Mirrors the
 * email_digest_service "send a single email" surface for parity. If
 * Resend is not configured, returns false and logs.
 *
 * NOTE: kept exported so a future PR can wire it from
 * Wave 2's panel actions without changing the service interface.
 */
export async function sendOperatorRunCompletedEmail(
  to: string,
  payload: {
    runId: string;
    workspaceId: string;
    notesCreated: number;
    toolCalls: number;
    promptPreview: string;
  }
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.info(
      { to, ...payload },
      "operator_notification_skipped_no_api_key"
    );
    return false;
  }
  await sendOperatorRunEmail(apiKey, to, {
    outcome: "completed",
    error: null,
    ...payload,
  });
  return true;
}

interface RunEmailPayload {
  outcome: NotifyOutcome;
  runId: string;
  workspaceId: string;
  notesCreated: number;
  toolCalls: number;
  error?: string | null;
  promptPreview: string;
}

/**
 * Subject line per outcome — kept in one place so the UI story (what the
 * user sees in their inbox) matches what the prefs card promises.
 */
function subjectForOutcome(outcome: NotifyOutcome): string {
  switch (outcome) {
    case "completed":
      return "Your Workspace Operator run completed";
    case "failed":
      return "Your Workspace Operator run failed";
    case "awaiting_approval":
      return "Your Workspace Operator plan is awaiting approval";
    case "cancelled":
      return "Your Workspace Operator run was cancelled";
  }
}

async function sendOperatorRunEmail(
  apiKey: string,
  to: string,
  payload: RunEmailPayload
): Promise<void> {
  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? "mail.contextstore.dev";
  const subject = subjectForOutcome(payload.outcome);

  const promptHtml = escapeHtml(payload.promptPreview);
  const errorHtml = payload.error ? escapeHtml(payload.error) : "";

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:32px auto;padding:24px;background:#fff;border-radius:8px;border:1px solid #eee;">
    <h1 style="margin:0 0 12px;font-size:18px;">${escapeHtml(subject)}</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#555;">Prompt: <em>${promptHtml}</em></p>
    <ul style="font-size:14px;color:#333;padding-left:18px;">
      <li>Notes created: ${payload.notesCreated}</li>
      <li>Tool calls: ${payload.toolCalls}</li>
      ${errorHtml ? `<li>Error: ${errorHtml}</li>` : ""}
    </ul>
    <p style="font-size:12px;color:#888;margin-top:16px;">Run id: ${escapeHtml(payload.runId)}</p>
  </div>
</body></html>`;

  const text = [
    subject,
    ``,
    `Prompt: ${payload.promptPreview}`,
    `Notes created: ${payload.notesCreated}`,
    `Tool calls: ${payload.toolCalls}`,
    payload.error ? `Error: ${payload.error}` : ``,
    ``,
    `Run id: ${payload.runId}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Workspace Operator <operator@${fromDomain}>`,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend responded ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function resolveUserEmail(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  // The admin client exposes auth.admin — not present on the cookie
  // client. The caller should pass an admin Supabase if it wants
  // notifications to actually send; otherwise we silently return null
  // and the notify* path returns `no_email`.
  const adminAuth = (
    supabase as unknown as {
      auth: {
        admin?: {
          getUserById: (
            id: string
          ) => Promise<{ data: { user: { email?: string | null } | null } }>;
        };
      };
    }
  ).auth.admin;
  if (!adminAuth) return null;

  try {
    const { data } = await adminAuth.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
