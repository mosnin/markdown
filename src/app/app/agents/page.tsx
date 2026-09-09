import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listProjects } from "@/server/repositories/project_repository";
import { listSessionsForProject } from "@/server/repositories/agent_session_repository";
import { UNFINISHED_END_REASONS } from "@/server/domain/constants/agent_session_constants";
import { PageHeader } from "@/components/ui/page-header";
import { Topbar, Breadcrumb } from "@/components/relay/topbar";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function relative(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * How a session ended, said plainly.
 *
 * `unknown` is rendered as an admission rather than smoothed into something
 * reassuring. The reaper goes to real trouble to avoid guessing "completed"
 * for a session it merely stopped hearing from; presenting that guess back to
 * a person as a tidy label would throw the honesty away at the last step.
 */
const END_REASON_LABEL: Record<string, string> = {
  completed: "Finished",
  usage_capped: "Hit plan limit",
  context_exhausted: "Ran out of context",
  crashed: "Crashed",
  user_stopped: "Stopped by hand",
  unknown: "Ended for an unrecorded reason",
};

export default async function AgentsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const projects = await listProjects(supabase, ctx.workspace.id).catch(() => []);

  const rows = (
    await Promise.all(
      projects.map(async (project) => {
        const sessions = await listSessionsForProject(admin, project.id, {
          limit: 25,
        }).catch(() => []);
        return sessions.map((session) => ({ project, session }));
      }),
    )
  )
    .flat()
    .sort(
      (a, b) =>
        Date.parse(b.session.last_seen_at ?? b.session.started_at) -
        Date.parse(a.session.last_seen_at ?? a.session.started_at),
    );

  const working = rows.filter((r) => r.session.status === "active").length;
  // The number worth surfacing: work that stopped without being finished is
  // work someone has to pick up, and nothing else on this page says so.
  const unfinished = rows.filter(
    (r) =>
      r.session.status === "ended" &&
      UNFINISHED_END_REASONS.includes(
        r.session.end_reason as (typeof UNFINISHED_END_REASONS)[number],
      ),
  ).length;

  return (
    <>
      <Topbar breadcrumb={<Breadcrumb segments={[{ label: "Agents" }]} />} />

      <div className="mx-auto flex w-full max-w-[1100px] flex-col px-6 pb-16">
        <PageHeader
          size="display"
          title="Agents"
          description={
            rows.length === 0
              ? "No agent has logged anything yet."
              : `${working} working now. ${unfinished} stopped without finishing.`
          }
        />

        {rows.length === 0 ? (
          <div className="rounded-12 border border-dashed border-hairline px-6 py-10 text-center">
            <p className="t-caption text-ink-3">
              Run{" "}
              <span className="t-mono-micro text-ink-2">poggle init</span> in a
              repository and start an agent. Sessions appear here on their first
              logged event.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-12 border border-hairline bg-raised">
            {rows.map(({ project, session }) => {
              const isActive = session.status === "active";
              const isUnfinished =
                session.status === "ended" &&
                UNFINISHED_END_REASONS.includes(
                  session.end_reason as (typeof UNFINISHED_END_REASONS)[number],
                );

              return (
                <li key={session.id}>
                  <Link
                    href={`/app/projects/${project.slug}`}
                    className="focus-ring-canvas flex flex-col gap-2 px-6 py-4 outline-none transition-colors hover:bg-state-hover"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "size-[7px] shrink-0 rounded-full",
                          isActive
                            ? "bg-positive-mark"
                            : isUnfinished
                              ? "bg-agent"
                              : "bg-neutral-mark",
                        )}
                      />
                      <span className="t-body-medium min-w-0 truncate text-ink">
                        {session.title || session.agent_tool}
                      </span>
                      {session.account_label ? (
                        <span className="t-mono-micro shrink-0 text-ink-4">
                          {session.account_label}
                        </span>
                      ) : null}
                      <span className="t-mono-micro ml-auto shrink-0 text-ink-4">
                        {relative(session.last_seen_at ?? session.started_at)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[19px]">
                      <span className="t-mono-micro text-ink-4">
                        {project.name}
                      </span>
                      {session.git_branch ? (
                        <span className="t-mono-micro text-ink-4">
                          {session.git_branch}
                        </span>
                      ) : null}
                      <span className="t-mono-micro text-ink-4">
                        {session.event_count} event
                        {session.event_count === 1 ? "" : "s"}
                      </span>
                      <span
                        className={cn(
                          "t-mono-micro",
                          isUnfinished ? "text-agent" : "text-ink-4",
                        )}
                      >
                        {isActive
                          ? "working"
                          : session.status === "idle"
                            ? "idle"
                            : (END_REASON_LABEL[session.end_reason ?? "unknown"] ??
                              "Ended")}
                      </span>
                    </div>

                    {session.goal ? (
                      <p className="t-caption pl-[19px] text-ink-2">
                        {session.goal}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
