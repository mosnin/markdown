import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listProjects } from "@/server/repositories/project_repository";
import { listActiveAgents } from "@/server/services/coordination_service";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Topbar, Breadcrumb } from "@/components/relay/topbar";

export const dynamic = "force-dynamic";

function relative(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "unknown";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The registry: every repository agents have logged against.
 *
 * The live count is the column that matters — it is the difference between a
 * project somebody worked on once and one that two agents are inside right
 * now, and it is the reason to open one rather than another.
 */
export default async function ProjectsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const projects = await listProjects(supabase, ctx.workspace.id);

  // The roster read demotes sessions that have gone quiet, so counts here are
  // honest rather than showing a capped agent as live forever.
  const admin = createAdminClient();
  const rosters = await Promise.all(
    projects.map(async (project) => ({
      id: project.id,
      agents: await listActiveAgents(admin, project.id).catch(() => []),
    })),
  );
  const liveByProject = new Map(
    rosters.map((r) => [r.id, r.agents.filter((a) => a.status === "active").length]),
  );

  return (
    <>
      <Topbar breadcrumb={<Breadcrumb segments={[{ label: "Projects" }]} />} />

      <div className="mx-auto flex w-full max-w-[1100px] flex-col px-6 pb-16">
        <PageHeader
          size="display"
          title="Projects"
          description="Every repository your agents have logged against. Open one to see who is working on it and what they have done."
        />

        {projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            body="A project appears the first time an agent logs an event against a repository. Install the hooks with poggle init and start an agent."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-12 border border-hairline bg-raised">
            {projects.map((project) => {
              const live = liveByProject.get(project.id) ?? 0;
              return (
                <li key={project.id}>
                  <Link
                    href={`/app/projects/${project.slug}`}
                    className="focus-ring-canvas flex items-center gap-5 px-6 py-5 outline-none transition-colors hover:bg-state-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="t-body-medium truncate text-ink">
                          {project.name}
                        </span>
                        {live > 0 ? (
                          <span className="t-label-caps inline-flex items-center gap-2 rounded-full bg-positive-wash px-3 py-1 text-positive-text">
                            <span className="size-[6px] rounded-full bg-positive-mark" />
                            {live} live
                          </span>
                        ) : null}
                      </div>
                      <p className="t-caption mt-1 truncate text-ink-3">
                        {project.slug}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="t-mono-micro text-ink-2">
                        {project.session_count} session
                        {project.session_count === 1 ? "" : "s"}
                      </p>
                      <p className="t-caption mt-1 text-ink-4">
                        active {relative(project.last_active_at)}
                      </p>
                    </div>
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
