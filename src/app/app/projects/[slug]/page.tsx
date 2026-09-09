import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getProjectBySlug,
  toProjectSlug,
} from "@/server/repositories/project_repository";
import { listSessionsForProject } from "@/server/repositories/agent_session_repository";
import { listRecentEventsForProject } from "@/server/repositories/session_event_repository";
import { listActiveAgents } from "@/server/services/coordination_service";
import { PageHeader } from "@/components/ui/page-header";
import { Topbar, Breadcrumb } from "@/components/relay/topbar";
import { AgentRoster } from "@/components/relay/agent-roster";
import { EventTimeline } from "@/components/relay/event-timeline";
import { SessionList } from "@/components/relay/session-list";

export const dynamic = "force-dynamic";

/**
 * A project at a glance: who is inside it right now, what has happened, and
 * which sessions produced it.
 *
 * Ordered by what a person opening this page actually wants to know. Live
 * agents first, because that is the question ("is anyone working on this?").
 * The timeline second, because that is the evidence. Sessions last, because
 * that is the history and it is the only part that is still there tomorrow.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const ctx = await requireAuthenticatedUser();

  const slug = toProjectSlug(rawSlug);
  if (!slug) notFound();

  const admin = createAdminClient();
  const project = await getProjectBySlug(admin, ctx.workspace.id, slug);
  if (!project) notFound();

  const [agents, events, sessions] = await Promise.all([
    listActiveAgents(admin, project.id).catch(() => []),
    listRecentEventsForProject(admin, project.id, { limit: 60 }).catch(() => []),
    listSessionsForProject(admin, project.id, { limit: 20 }).catch(() => []),
  ]);

  const live = agents.filter((a) => a.status === "active").length;

  return (
    <>
      <Topbar
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Projects", href: "/app/projects" },
              { label: project.name },
            ]}
          />
        }
      />

      <div className="mx-auto flex w-full max-w-[1100px] flex-col px-6 pb-16">
        <PageHeader
          size="display"
          kicker={project.slug}
          title={project.name}
          description={
            live > 0
              ? `${live} agent${live === 1 ? "" : "s"} working right now.`
              : "No agents are working on this project at the moment."
          }
        />

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
            projectSlug={project.slug}
          />
          <SessionList sessions={sessions} />
        </div>
      </div>
    </>
  );
}
