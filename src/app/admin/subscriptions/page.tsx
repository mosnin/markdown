import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SubscriptionTable, type SubscriptionRow } from "./subscription_table";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRO_MONTHLY_PRICE_USD = 12;

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchSubscriptionRows(): Promise<SubscriptionRow[]> {
  const adminClient = createAdminClient();

  // Fetch all workspace_subscriptions joined with workspaces for name/owner_id
  const { data: subs, error: subsError } = await adminClient
    .from("workspace_subscriptions")
    .select(
      "workspace_id, plan, status, current_period_end, creem_subscription_id, manually_overridden, override_operator_quota"
    )
    .order("workspace_id");

  if (subsError || !subs || subs.length === 0) return [];

  // Fetch corresponding workspace rows (name + owner_id)
  const workspaceIds = subs.map((s: { workspace_id: string }) => s.workspace_id);

  const { data: workspaces, error: wsError } = await adminClient
    .from("workspaces")
    .select("id, name, owner_id")
    .in("id", workspaceIds);

  if (wsError || !workspaces) return [];

  // Build a lookup: workspace_id → { name, owner_id }
  const wsMap = new Map(
    (workspaces as Array<{ id: string; name: string; owner_id: string }>).map(
      (w) => [w.id, w]
    )
  );

  // Resolve emails: fetch all users in a single call and build a lookup map
  const { data: { users: allUsers } } = await adminClient.auth.admin.listUsers({
    perPage: 1000,
  });
  const emailMap = new Map(
    allUsers.filter((u) => u.email).map((u) => [u.id, u.email as string])
  );

  // Assemble the final rows
  return subs.map(
    (sub: {
      workspace_id: string;
      plan: string;
      status: string | null;
      current_period_end: string | null;
      creem_subscription_id: string | null;
      manually_overridden: boolean | null;
      override_operator_quota: boolean | null;
    }) => {
      const ws = wsMap.get(sub.workspace_id);
      return {
        workspace_id: sub.workspace_id,
        workspace_name: ws?.name ?? sub.workspace_id,
        owner_email: ws ? (emailMap.get(ws.owner_id) ?? "—") : "—",
        plan: (sub.plan as SubscriptionRow["plan"]) ?? "free",
        status: (sub.status as SubscriptionRow["status"]) ?? null,
        current_period_end: sub.current_period_end,
        creem_subscription_id: sub.creem_subscription_id,
        manually_overridden: sub.manually_overridden ?? false,
        override_operator_quota: sub.override_operator_quota ?? false,
      };
    }
  );
}

// ─── Stat cards ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card size="sm">
      <CardHeader className="px-5 pt-4 pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SubscriptionsPage() {
  await requireAdmin();

  const rows = await fetchSubscriptionRows();

  // ── Summary stats ──────────────────────────────────────────────────────────
  const proCount = rows.filter((r) => r.plan === "pro").length;
  const businessCount = rows.filter((r) => r.plan === "business").length;
  const mrr = proCount * PRO_MONTHLY_PRICE_USD;
  const activeCount = rows.filter((r) => r.status === "active").length;
  const cancelledCount = rows.filter((r) => r.status === "cancelled").length;
  const pastDueCount = rows.filter((r) => r.status === "past_due").length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Subscriptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Billing overview and manual plan overrides for all workspaces.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <StatCard label="Pro subscribers" value={proCount} />
        <StatCard label="Business subscribers" value={businessCount} />
        <StatCard
          label="MRR"
          value={`$${mrr.toLocaleString()}`}
        />
        <StatCard label="Active" value={activeCount} />
        <StatCard label="Cancelled" value={cancelledCount} />
        <StatCard label="Past due" value={pastDueCount} />
      </div>

      {/* Subscription table */}
      <SubscriptionTable rows={rows} />
    </div>
  );
}
