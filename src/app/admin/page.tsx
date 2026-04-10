import { requireAdmin } from "@/server/auth/require_admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin Overview page.
 *
 * Shows key platform metrics and recent signups.
 * Uses the service-role admin client (bypasses RLS) for all queries.
 */
export default async function AdminOverviewPage() {
  // Auth gate — requireAdmin() will redirect if unauthorized
  await requireAdmin();

  const adminClient = createAdminClient();

  // ── Metrics ────────────────────────────────────────────────────────────────

  // Total users — query auth.users via admin API
  const { data: usersData, error: usersError } =
    await adminClient.auth.admin.listUsers({ page: 1, perPage: 1 });
  const totalUsers = usersError ? null : (usersData?.total ?? 0);

  // Total workspaces
  const { count: totalWorkspaces } = await adminClient
    .from("workspaces")
    .select("id", { count: "exact", head: true });

  // Total notes
  const { count: totalNotes } = await adminClient
    .from("notes")
    .select("id", { count: "exact", head: true });

  // Pro subscribers — gracefully handle missing table
  let proSubscribers: number | null = 0;
  try {
    const { count, error } = await adminClient
      .from("workspace_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if (error) {
      proSubscribers = 0;
    } else {
      proSubscribers = count ?? 0;
    }
  } catch {
    proSubscribers = 0;
  }

  // ── Recent signups (last 10) ───────────────────────────────────────────────
  const { data: recentUsersData } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 10,
  });

  // Sort descending by created_at (API returns newest first by default, but sort to be safe)
  const recentSignups = (recentUsersData?.users ?? [])
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 10);

  // ── Render ─────────────────────────────────────────────────────────────────

  const stats = [
    {
      label: "Total Users",
      value: totalUsers === null ? "—" : totalUsers.toLocaleString(),
      description: "Registered accounts",
    },
    {
      label: "Total Workspaces",
      value: totalWorkspaces === null ? "—" : totalWorkspaces.toLocaleString(),
      description: "Active workspaces",
    },
    {
      label: "Total Notes",
      value: totalNotes === null ? "—" : totalNotes.toLocaleString(),
      description: "Notes across all boxes",
    },
    {
      label: "Pro Subscribers",
      value: proSubscribers === null ? "—" : proSubscribers.toLocaleString(),
      description: "Active paid subscriptions",
    },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto w-full space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-title font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform-wide metrics for Context Store.
        </p>
      </div>

      {/* Stat cards */}
      <section aria-label="Platform metrics">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border bg-card p-4 shadow-xs"
            >
              <p className="text-caption text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {stat.value}
              </p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {stat.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent signups */}
      <section aria-label="Recent signups">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Recent Signups
        </h2>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {recentSignups.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Email
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Signed up
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentSignups.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/20 transition-fast">
                    <td className="px-4 py-2.5 text-foreground">
                      {u.email ?? (
                        <span className="text-muted-foreground italic">
                          no email
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                      {new Date(u.created_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
