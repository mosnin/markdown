import { type SupabaseClient } from "@supabase/supabase-js";
import type { DraftBranch } from "./branch_service";

/**
 * Branch lifecycle + auto-cleanup service.
 *
 * Workspaces that opt in can have draft branches automatically warned and
 * then discarded after an idle period. The policy is workspace-level
 * (`workspace_branch_retention_policies`) and the detection + action loop
 * is driven by:
 *
 *   1. `touchBranchActivity(branchId)` — called from every branch-local
 *      write path. Stamps `draft_branches.last_activity_at = now()`.
 *   2. `listStaleBranches(workspaceId, { idleDays })` — returns open
 *      branches whose `last_activity_at` is older than `idleDays` days.
 *   3. `warnStaleBranches(workspaceId)` — for every branch past
 *      `warn_after_idle_days` with no recent warning, bumps
 *      `warning_count` + stamps `last_warned_at` + emits
 *      `branch.stale_warned` audit.
 *   4. `autoDiscardExpiredBranches(workspaceId)` — for every branch past
 *      `auto_discard_after_days` with at least one prior warning, runs the
 *      standard discard flow and emits `branch.auto_discarded` audit.
 *
 * The warn and discard loops are safe to call on workspaces that haven't
 * opted in — they check `policy.enabled` and bail early if false. This
 * keeps the cron endpoint loop trivial: iterate every workspace with a
 * row, call both functions, done.
 *
 * Service layer does NOT enforce admin — `setRetentionPolicy` is called
 * from a server action that gates with `requireAdminRole()`. Keeping the
 * admin check out of the service lets the cron route call the same
 * service with a platform-level shared secret without faking a workspace
 * admin identity.
 */

export interface RetentionPolicy {
  workspace_id: string;
  auto_discard_after_days: number;
  warn_after_idle_days: number;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string | null;
}

export const DEFAULT_AUTO_DISCARD_AFTER_DAYS = 60;
export const DEFAULT_WARN_AFTER_IDLE_DAYS = 30;

/**
 * Cap on warnings per branch. Two warnings give the branch author a clear
 * heads-up without spamming; after that the auto-discard loop is the next
 * step. Surfaced as a constant so tests can reference it.
 */
export const MAX_WARNING_COUNT = 2;

function defaultPolicy(workspaceId: string): RetentionPolicy {
  return {
    workspace_id: workspaceId,
    auto_discard_after_days: DEFAULT_AUTO_DISCARD_AFTER_DAYS,
    warn_after_idle_days: DEFAULT_WARN_AFTER_IDLE_DAYS,
    enabled: false,
    updated_by: null,
    updated_at: null,
    created_at: null,
  };
}

// ─── Policy CRUD ─────────────────────────────────────────────────────────────

/**
 * Returns the workspace's retention policy, or a disabled default when no
 * row exists. Callers never need to special-case the absent row.
 */
export async function getRetentionPolicy(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<RetentionPolicy> {
  const { data } = await supabase
    .from("workspace_branch_retention_policies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return defaultPolicy(workspaceId);
  return data as RetentionPolicy;
}

export interface RetentionPolicyPatch {
  enabled?: boolean;
  warn_after_idle_days?: number;
  auto_discard_after_days?: number;
}

/**
 * Upsert the workspace's retention policy. The caller is responsible for
 * admin gating — this service accepts the write unconditionally so the
 * cron endpoint + service worker paths can share the same entry point.
 */
export async function setRetentionPolicy(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  patch: RetentionPolicyPatch
): Promise<RetentionPolicy> {
  const prior = await getRetentionPolicy(supabase, workspaceId);

  const warn =
    patch.warn_after_idle_days ?? prior.warn_after_idle_days;
  const auto =
    patch.auto_discard_after_days ?? prior.auto_discard_after_days;
  const enabled = patch.enabled ?? prior.enabled;

  if (!Number.isFinite(warn) || warn <= 0) {
    throw new Error("warn_after_idle_days must be a positive integer");
  }
  if (!Number.isFinite(auto) || auto <= 0) {
    throw new Error("auto_discard_after_days must be a positive integer");
  }
  if (auto < warn) {
    throw new Error(
      "auto_discard_after_days must be >= warn_after_idle_days"
    );
  }

  const row = {
    workspace_id: workspaceId,
    warn_after_idle_days: warn,
    auto_discard_after_days: auto,
    enabled,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("workspace_branch_retention_policies")
    .upsert(row, { onConflict: "workspace_id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save retention policy");
  }
  return data as RetentionPolicy;
}

// ─── Activity tracking ───────────────────────────────────────────────────────

/**
 * Stamp the branch's `last_activity_at` to now. Called from every
 * branch-local write path — notes, files, folder overrides, placement
 * overrides, pending ops, etc. Any failure is swallowed by the service
 * wrapper at the call site so a rare write failure doesn't block the
 * user's edit.
 *
 * `actorId` is accepted for future per-actor instrumentation; today we
 * only stamp the timestamp.
 */
export async function touchBranchActivity(
  supabase: SupabaseClient,
  branchId: string,
  _actorId: string
): Promise<void> {
  await supabase
    .from("draft_branches")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", branchId)
    .eq("status", "open");
}

// ─── Stale detection ─────────────────────────────────────────────────────────

export interface StaleBranchRow {
  branch: DraftBranch;
  daysIdle: number;
}

/**
 * Returns every open branch in the workspace whose `last_activity_at`
 * (or `created_at` fallback when activity has never been recorded) is
 * older than `idleDays` days. The fallback means a brand-new branch
 * with no writes still ages out — otherwise a branch created and never
 * touched could live forever.
 */
export async function listStaleBranches(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { idleDays?: number } = {}
): Promise<StaleBranchRow[]> {
  const idleDays =
    opts.idleDays ?? DEFAULT_WARN_AFTER_IDLE_DAYS;
  const cutoff = new Date(Date.now() - idleDays * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("draft_branches")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "open");

  const rows = (data ?? []) as DraftBranch[];
  const now = Date.now();
  const stale: StaleBranchRow[] = [];
  for (const b of rows) {
    const activityISO =
      b.last_activity_at ?? b.created_at ?? null;
    if (!activityISO) continue;
    const activityAt = new Date(activityISO);
    if (activityAt > cutoff) continue;
    const days = Math.floor((now - activityAt.getTime()) / (24 * 60 * 60 * 1000));
    stale.push({ branch: b, daysIdle: days });
  }
  stale.sort((a, b) => b.daysIdle - a.daysIdle);
  return stale;
}

// ─── Warning loop ────────────────────────────────────────────────────────────

/**
 * Warn every stale branch in the workspace that hasn't been warned
 * recently. For each branch past the warn threshold:
 *
 *   - increments `warning_count`
 *   - stamps `last_warned_at = now()`
 *   - emits `branch.stale_warned` audit event
 *
 * Caps at `MAX_WARNING_COUNT` warnings per branch. Once a branch has
 * hit the cap, this function stops touching it — the auto-discard loop
 * is what closes the book.
 *
 * Returns the number of branches newly warned in this run.
 */
export async function warnStaleBranches(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<number> {
  const policy = await getRetentionPolicy(supabase, workspaceId);
  if (!policy.enabled) return 0;

  const stale = await listStaleBranches(supabase, workspaceId, {
    idleDays: policy.warn_after_idle_days,
  });

  const cooldownDays = Math.max(
    1,
    Math.floor(policy.warn_after_idle_days / 3)
  );
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const { createAuditEvent } = await import(
    "@/server/repositories/audit_event_repository"
  );

  let warned = 0;
  for (const { branch, daysIdle } of stale) {
    if (branch.warning_count != null && branch.warning_count >= MAX_WARNING_COUNT) {
      continue;
    }
    if (branch.last_warned_at) {
      const lastMs = new Date(branch.last_warned_at).getTime();
      if (now - lastMs < cooldownMs) continue;
    }

    const nextCount = (branch.warning_count ?? 0) + 1;
    const { error } = await supabase
      .from("draft_branches")
      .update({
        last_warned_at: new Date(now).toISOString(),
        warning_count: nextCount,
      })
      .eq("id", branch.id)
      .eq("status", "open");
    if (error) continue;

    try {
      await createAuditEvent(supabase, {
        workspace_id: workspaceId,
        actor_type: "system",
        actor_id: branch.created_by ?? workspaceId,
        object_type: "draft_branch",
        object_id: branch.id,
        event_type: "branch.stale_warned",
        metadata: {
          warning_count: nextCount,
          days_idle: daysIdle,
          warn_after_idle_days: policy.warn_after_idle_days,
          auto_discard_after_days: policy.auto_discard_after_days,
        },
      });
    } catch {
      // audit failure shouldn't block the warning loop
    }
    warned += 1;
  }
  return warned;
}

// ─── Auto-discard loop ───────────────────────────────────────────────────────

/**
 * Discard every branch past the auto-discard threshold that has already
 * been warned at least once. The warning gate means a branch a user
 * dismissed via the UI (which zeroes the warning count) won't be
 * auto-discarded until it goes stale again and gets re-warned.
 *
 * Each discard goes through the canonical discard flow:
 * `discardDraftBranch()` + structural cleanup via the same branch-local
 * services as the user-facing discard action. An audit event of type
 * `branch.auto_discarded` is emitted alongside the standard
 * `branch.discarded` audit.
 *
 * Returns the count of branches actually discarded.
 */
export async function autoDiscardExpiredBranches(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<number> {
  const policy = await getRetentionPolicy(supabase, workspaceId);
  if (!policy.enabled) return 0;

  const stale = await listStaleBranches(supabase, workspaceId, {
    idleDays: policy.auto_discard_after_days,
  });

  const { discardDraftBranch } = await import("./branch_service");
  const { createAuditEvent } = await import(
    "@/server/repositories/audit_event_repository"
  );
  const { dropAllPendingOpsForBranch } = await import("./pending_op_service");
  const { dropAllBoxOverlaysForBranch } = await import(
    "./box_branch_metadata_service"
  );
  const { dropAllFolderOverridesForBranch } = await import(
    "./folder_branch_service"
  );
  const { dropAllPlacementOverridesForBranch } = await import(
    "./placement_branch_service"
  );

  let discarded = 0;
  for (const { branch, daysIdle } of stale) {
    const warningCount = branch.warning_count ?? 0;
    if (warningCount < 1) continue;

    try {
      await supabase.from("files").delete().eq("branch_id", branch.id);
      await supabase.from("object_links").delete().eq("branch_id", branch.id);
      await supabase.from("note_links").delete().eq("branch_id", branch.id);
      await supabase
        .from("box_object_attachments")
        .delete()
        .eq("branch_id", branch.id);
      await supabase.from("notes").delete().eq("branch_id", branch.id);
      await supabase.from("folders").delete().eq("branch_id", branch.id);
      await supabase.from("boxes").delete().eq("branch_id", branch.id);
      await supabase.from("branch_heads").delete().eq("branch_id", branch.id);
      await dropAllPendingOpsForBranch(supabase, branch.id);
      await dropAllBoxOverlaysForBranch(supabase, branch.id);
      await dropAllFolderOverridesForBranch(supabase, branch.id);
      await dropAllPlacementOverridesForBranch(supabase, branch.id);
      await discardDraftBranch(supabase, branch.id);

      try {
        await createAuditEvent(supabase, {
          workspace_id: workspaceId,
          actor_type: "system",
          actor_id: branch.created_by ?? workspaceId,
          object_type: "draft_branch",
          object_id: branch.id,
          event_type: "branch.auto_discarded",
          metadata: {
            days_idle: daysIdle,
            warning_count: warningCount,
            auto_discard_after_days: policy.auto_discard_after_days,
            name: branch.name,
          },
        });
      } catch {
        // audit failure shouldn't block the loop
      }
      discarded += 1;
    } catch {
      // per-branch failures are skipped so the loop continues
    }
  }
  return discarded;
}

// ─── Dismiss a warning ───────────────────────────────────────────────────────

/**
 * User action: "keep this branch active". Resets the warning count and
 * touches activity so the warn loop won't pick the branch up again
 * until a fresh idle period elapses.
 */
export async function dismissStaleWarning(
  supabase: SupabaseClient,
  branchId: string,
  _actorId: string
): Promise<void> {
  await supabase
    .from("draft_branches")
    .update({
      last_activity_at: new Date().toISOString(),
      last_warned_at: null,
      warning_count: 0,
    })
    .eq("id", branchId)
    .eq("status", "open");
}
