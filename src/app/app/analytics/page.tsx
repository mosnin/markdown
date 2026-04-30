import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { canAdmin } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import {
  getWorkspaceMetrics,
  getContentHealth,
  getContributorActivity,
} from "@/server/services/workspace_analytics_service";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PageHeader } from "@/components/product/page_header";

/**
 * Workspace analytics & content health dashboard.
 *
 * Admin-only page showing workspace metrics, search analytics,
 * contributor activity, and content health indicators.
 */
export default async function AnalyticsPage() {
  const ctx = await requireAuthenticatedUser();

  if (!canAdmin(ctx.workspace.role)) {
    redirect("/app");
  }

  const supabase = await createClient();

  const [metrics, health, contributors] = await Promise.all([
    getWorkspaceMetrics(supabase, ctx.workspace.id),
    getContentHealth(supabase, ctx.workspace.id),
    getContributorActivity(supabase, ctx.workspace.id, { days: 7 }),
  ]);

  const zeroResultQueries = metrics.topSearchQueries.filter(
    (q) => q.count === 0,
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        eyebrow="Workspace"
        title="Analytics"
        description="Workspace health, search analytics, and content metrics."
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
          {/* ── Overview cards ─────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <MetricCard label="Notes" value={metrics.totalNotes} />
            <MetricCard label="Files" value={metrics.totalFiles} />
            <MetricCard label="Folders" value={metrics.totalFolders} />
            <MetricCard label="Boxes" value={metrics.totalBoxes} />
            <MetricCard label="Skills" value={metrics.totalSkills} />
            <MetricCard label="Agents" value={metrics.totalAgents} />
            <MetricCard
              label="Notes this week"
              value={metrics.notesCreatedThisWeek}
            />
            <MetricCard
              label="Notes this month"
              value={metrics.notesCreatedThisMonth}
            />
          </div>

          {/* ── Contributors ──────────────────────────────────── */}
          <Card>
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-base font-semibold">
                Top contributors (last 7 days)
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {metrics.activeContributors} active contributor
                {metrics.activeContributors !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-6 pt-4 pb-6">
              {contributors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No activity in the last 7 days.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">User</th>
                      <th className="pb-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contributors.slice(0, 10).map((c) => (
                      <tr key={c.userId} className="border-b last:border-0">
                        <td className="py-2 font-mono text-xs">
                          {c.userId.slice(0, 8)}...
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {c.eventCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* ── Search analytics ──────────────────────────────── */}
          <Card>
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-base font-semibold">
                Top search queries (last 30 days)
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="px-6 pt-4 pb-6">
              {metrics.topSearchQueries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No searches recorded yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Query</th>
                      <th className="pb-2 text-right font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.topSearchQueries.map((q) => (
                      <tr key={q.query} className="border-b last:border-0">
                        <td className="py-2">{q.query}</td>
                        <td className="py-2 text-right tabular-nums">
                          {q.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* ── Busiest boxes ─────────────────────────────────── */}
          <Card>
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-base font-semibold">
                Busiest boxes
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Boxes ranked by note count
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-6 pt-4 pb-6">
              {metrics.busiestBoxes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No boxes yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Box</th>
                      <th className="pb-2 text-right font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.busiestBoxes.map((b) => (
                      <tr key={b.id} className="border-b last:border-0">
                        <td className="py-2">{b.name}</td>
                        <td className="py-2 text-right tabular-nums">
                          {b.noteCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* ── Content health: orphaned notes ────────────────── */}
          <Card>
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-base font-semibold">
                Orphaned notes
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Notes with zero inbound or outbound links
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-6 pt-4 pb-6">
              {health.orphanedNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All notes are linked. Great!
                </p>
              ) : (
                <ul className="space-y-2">
                  {health.orphanedNotes.slice(0, 20).map((n) => (
                    <li
                      key={n.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <a
                          href={`/app/notes/${n.id}`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {n.title}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          Updated{" "}
                          {new Date(n.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <a
                        href={`/app/notes/${n.id}`}
                        className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                      >
                        Add link
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Content health: stale notes ───────────────────── */}
          <Card>
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-base font-semibold">
                Stale notes
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Notes not updated in 90+ days
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-6 pt-4 pb-6">
              {health.staleNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No stale notes found.
                </p>
              ) : (
                <ul className="space-y-2">
                  {health.staleNotes.slice(0, 20).map((n) => (
                    <li
                      key={n.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <a
                          href={`/app/notes/${n.id}`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {n.title}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          Last updated{" "}
                          {new Date(n.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Content health: empty folders ─────────────────── */}
          <Card>
            <CardHeader className="px-6 pt-6 pb-4">
              <CardTitle className="text-base font-semibold">
                Empty folders
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Folders with no notes or sub-folders
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="px-6 pt-4 pb-6">
              {health.emptyFolders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No empty folders found.
                </p>
              ) : (
                <ul className="space-y-2">
                  {health.emptyFolders.slice(0, 20).map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <a
                        href={`/app/folders/${f.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="px-4 py-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
