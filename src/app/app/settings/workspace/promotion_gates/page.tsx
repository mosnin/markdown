import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdminRole } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { listGates, listRecentRunsByGate } from "@/server/services/branch_promotion_gate_service";
import { PageHeader } from "@/components/product/page_header";
import { PromotionGatesManager } from "./promotion_gates_manager";
import type { PromotionGateRow } from "./actions";

/**
 * Workspace admin surface for branch-promotion webhook gates.
 *
 * Gates are lightweight CI/CD-style hooks that fire before a branch is
 * promoted to main. Each gate returns pass/fail; any failure vetoes
 * the promotion. See `docs/branch_promotion_gates_v1.md`.
 *
 * Role gating: `requireAdminRole()` at the top of the page. Non-admins
 * are bounced with an error rather than a silent redirect because
 * they've already navigated to a settings subpage — keeping the
 * response explicit avoids a "why did I land on /app" mystery.
 */
export default async function PromotionGatesPage() {
  // Explicit admin guard. Throws which Next renders as an error page,
  // matching the rest of the admin-gated action surface.
  const ctx = await requireAdminRole();
  const supabase = await createClient();
  const gates = await listGates(supabase, ctx.workspace.id);
  const runsByGate = await listRecentRunsByGate(supabase, ctx.workspace.id, 5);

  const initialGates: PromotionGateRow[] = gates.map((g) => {
    const runs = runsByGate[g.id] ?? [];
    const passed = runs.filter((r) => r.status === "passed").length;
    const failed = runs.filter(
      (r) => r.status !== "passed" && r.status !== "pending"
    ).length;
    return {
      id: g.id,
      name: g.name,
      webhook_url: g.webhook_url,
      timeout_seconds: g.timeout_seconds,
      status: g.status,
      created_at: g.created_at,
      updated_at: g.updated_at,
      recent_runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        created_at: r.created_at,
      })),
      passed_count: passed,
      failed_count: failed,
    };
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Branch promotion gates"
        description="CI/CD-style webhooks that run before a branch is promoted to main. Each gate can veto the promotion. Signing secrets are shown once on creation — store them safely."
        actions={
          <Link
            href="/app/settings"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </Link>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <PromotionGatesManager initialGates={initialGates} />
        </div>
      </div>
    </div>
  );
}
