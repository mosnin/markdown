import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listProjects } from "@/server/repositories/project_repository";
import { listRecentEventsForProject } from "@/server/repositories/session_event_repository";
import { listActiveAgents } from "@/server/services/coordination_service";
import { PageHeader } from "@/components/ui/page-header";
import { Topbar, Breadcrumb } from "@/components/relay/topbar";
import { AgentRoster } from "@/components/relay/agent-roster";
import { EventTimeline } from "@/components/relay/event-timeline";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The live view: one project's whole relay as it happens.
 *
 * Deliberately scoped to a single project rather than the whole workspace.
 * A cross-project firehose reads as noise — the question this page answers is
 * "what is happening on the thing I am working on", and events from an
 * unrelated repository only make that harder to see. The switcher is the
 * cheapest way to move between them without pretending they are one stream.
 *
 * Defaults to the project with the most recent activity, because that is
 * almost always the one you opened this page to look at.
 */
export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: requested } = await searchParams;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const projects = await listProjects(supabase, ctx.workspace.id).catch(() => []);
  const active =
    projects.find((p) => p.slug === requested) ?? projects[0] ?? null;

  if (!active) {
    return (
      <>
        <Topbar breadcrumb={<Breadcrumb segments={[{ label: "Live" }]} />} />
        <div className="mx-auto flex w-full max-w-[1100px] flex-col px-6 pb-16">
          <PageHeader
            size="display"
            title="Live"
            description="Nothing to watch yet."
          />
          <div className="rounded-12 border border-dashed border-hairline px-6 py-10 text-center">
            <p className="t-caption text-ink-3">
              A project appears here the first time an agent logs an event
              against a repository.{" "}
              <Link href="/app/settings/relay_keys" className="t-link">
                Set up a relay key
              </Link>{" "}
              to start capturing.
            </p>
          </div>
        </div>
      </>
    );
  }

  const [agents, events] = await Promise.all([
    listActiveAgents(admin, active.id).catch(() => []),
    listRecentEventsForProject(admin, active.id, { limit: 80 }).catch(() => []),
  ]);

  const live = agents.filter((a) => a.status === "active").length;

  return (
    <>
      <Topbar breadcrumb={<Breadcrumb segments={[{ label: "Live" }]} />} />

      <div className="mx-auto flex w-full max-w-[1100px] flex-col px-6 pb-16">
        <PageHeader
          size="display"
          kicker={active.slug}
          title="Live"
          description={
            live > 0
              ? `${live} agent${live === 1 ? "" : "s"} working on ${active.name} right now.`
              : `Nobody is working on ${active.name} at the moment. New events still arrive here as they are logged.`
          }
        />

        {projects.length > 1 ? (
          <nav className="mb-8 flex flex-wrap gap-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/app/live?project=${encodeURIComponent(project.slug)}`}
                aria-current={project.id === active.id ? "page" : undefined}
                className={cn(
                  "focus-ring-canvas t-caption rounded-8 border px-3 py-1.5 outline-none transition-colors",
                  project.id === active.id
                    ? "border-strong bg-inset text-ink"
                    : "border-hairline text-ink-2 hover:border-strong hover:text-ink",
                )}
              >
                {project.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="flex flex-col gap-10">
          <AgentRoster agents={agents} />
          <EventTimeline
            events={events.map((e) => ({
              id: e.id,
              session_id: e.session_id,
              event_type: e.event_type,
              summary: e.summary,
              importance: e.importance,
              files: e.files,
              occurred_at: e.occurred_at,
            }))}
            projectSlug={active.slug}
          />
        </div>
      </div>
    </>
  );
}
