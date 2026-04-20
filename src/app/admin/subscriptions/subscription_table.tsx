"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  overridePlanAction,
  setOperatorQuotaOverrideAction,
} from "./actions";
import type { WorkspacePlan } from "@/server/services/subscription_service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionRow {
  workspace_id: string;
  workspace_name: string;
  owner_email: string;
  plan: WorkspacePlan;
  status: "active" | "cancelled" | "past_due" | null;
  current_period_end: string | null;
  creem_subscription_id: string | null;
  manually_overridden: boolean;
  override_operator_quota: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAN_LABEL: Record<WorkspacePlan, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
};

function PlanBadge({
  plan,
  manually_overridden,
}: {
  plan: WorkspacePlan;
  manually_overridden: boolean;
}) {
  const label = PLAN_LABEL[plan];
  const variant = plan === "business" ? "default" : plan === "pro" ? "default" : "secondary";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={variant}>{label}</Badge>
      {manually_overridden && (
        <Badge variant="outline" className="text-[10px]">
          Manually set
        </Badge>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: SubscriptionRow["status"] }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const variants = {
    active: "success",
    cancelled: "secondary",
    past_due: "warning",
  } as const;
  const labels = {
    active: "Active",
    cancelled: "Cancelled",
    past_due: "Past Due",
  } as const;
  return (
    <Badge variant={variants[status] ?? "secondary"}>{labels[status]}</Badge>
  );
}

function formatDate(isoString: string | null): string {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Override dialog ──────────────────────────────────────────────────────────

function OverrideDialog({ row }: { row: SubscriptionRow }) {
  const [open, setOpen] = useState(false);
  const [targetPlan, setTargetPlan] = useState<WorkspacePlan>("pro");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const targetLabel = PLAN_LABEL[targetPlan];

  function openFor(plan: WorkspacePlan) {
    setTargetPlan(plan);
    setError(null);
    setOpen(true);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await overridePlanAction(row.workspace_id, targetPlan);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error ?? "Unknown error");
      }
    });
  }

  return (
    <>
      {/* Trigger buttons — one per target plan */}
      <span className="inline-flex gap-1 flex-wrap">
        {row.plan !== "pro" && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => openFor("pro")}
            aria-label={`Override ${row.workspace_name} to Pro plan`}
          >
            Set Pro
          </Button>
        )}
        {row.plan !== "business" && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => openFor("business")}
            aria-label={`Override ${row.workspace_name} to Business plan`}
          >
            Set Business
          </Button>
        )}
        {row.plan !== "free" && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => openFor("free")}
            aria-label={`Override ${row.workspace_name} to Free plan`}
          >
            Set Free
          </Button>
        )}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override plan</DialogTitle>
            <DialogDescription>
              Override workspace &ldquo;{row.workspace_name}&rdquo; to{" "}
              <strong>{targetLabel} plan</strong>? This won&rsquo;t affect their
              Creem subscription.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Saving…" : `Set ${targetLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Operator-quota override toggle ──────────────────────────────────────────

function OperatorQuotaOverrideToggle({ row }: { row: SubscriptionRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = await setOperatorQuotaOverrideAction(
        row.workspace_id,
        !row.override_operator_quota
      );
      if (!result.ok) setError(result.error ?? "Unknown error");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={row.override_operator_quota ? "default" : "outline"}
        size="xs"
        disabled={isPending}
        onClick={handleToggle}
        aria-pressed={row.override_operator_quota}
        aria-label={`Toggle operator quota override for ${row.workspace_name}`}
      >
        {isPending
          ? "Saving…"
          : row.override_operator_quota
            ? "Quota bypass ON"
            : "Bypass quota"}
      </Button>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

export function SubscriptionTable({ rows }: { rows: SubscriptionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <p className="text-sm font-medium">No subscriptions yet</p>
        <p className="mt-1 text-xs">
          Subscription rows will appear here once workspaces sign up.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            {[
              "Workspace",
              "Owner email",
              "Plan",
              "Status",
              "Period ends",
              "Creem subscription ID",
              "Operator quota",
              "Actions",
            ].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr
              key={row.workspace_id}
              className="bg-background transition-colors hover:bg-muted/30"
            >
              <td className="px-4 py-3 font-medium text-foreground">
                {row.workspace_name}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.owner_email}
              </td>
              <td className="px-4 py-3">
                <PlanBadge
                  plan={row.plan}
                  manually_overridden={row.manually_overridden}
                />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(row.current_period_end)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {row.creem_subscription_id ?? (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <OperatorQuotaOverrideToggle row={row} />
              </td>
              <td className="px-4 py-3">
                <OverrideDialog row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
