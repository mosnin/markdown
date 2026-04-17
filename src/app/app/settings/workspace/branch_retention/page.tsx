import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import {
  getRetentionPolicy,
  listStaleBranches,
} from "@/server/services/branch_lifecycle_service";
import { RetentionPolicyForm } from "./retention_policy_form";
import { StaleBranchesPanel } from "./stale_branches_panel";

/**
 * Admin surface for the branch retention policy.
 *
 * Any workspace member may view the page — read access is useful for
 * members who want to understand the auto-discard rules in play. Only
 * admins see the editable controls; viewers and regular members see
 * the values rendered as a read-only summary.
 */
export default async function BranchRetentionPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const isAdmin = canAdmin(ctx.workspace.role);

  const policy = await getRetentionPolicy(supabase, ctx.workspace.id);
  const stale = await listStaleBranches(supabase, ctx.workspace.id, {
    idleDays: policy.warn_after_idle_days,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background px-6 pt-6 pb-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/app/settings"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to settings
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Branch retention
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Automatically warn authors about idle draft branches and discard
          them after a retention period. Opt-in per workspace. Discarded
          branches leave their version history as audit trail — nothing
          promoted to main is ever deleted.
        </p>
      </div>
      <Separator />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <RetentionPolicyForm
            initial={{
              enabled: policy.enabled,
              warn_after_idle_days: policy.warn_after_idle_days,
              auto_discard_after_days: policy.auto_discard_after_days,
            }}
            canEdit={isAdmin}
          />

          <StaleBranchesPanel
            initialRows={stale.map((s) => ({
              id: s.branch.id,
              name: s.branch.name,
              description: s.branch.description,
              daysIdle: s.daysIdle,
              warningCount: s.branch.warning_count ?? 0,
              lastWarnedAt: s.branch.last_warned_at,
            }))}
            warnAfterIdleDays={policy.warn_after_idle_days}
            autoDiscardAfterDays={policy.auto_discard_after_days}
            canRunCleanup={isAdmin}
          />
        </div>
      </div>
    </div>
  );
}
