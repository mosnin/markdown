import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listProjects } from "@/server/repositories/project_repository";
import { listRelayKeys } from "@/server/services/relay_key_service";
import { listActiveAgents } from "@/server/services/coordination_service";
import { PageHeader } from "@/components/ui/page-header";
import { Topbar, Breadcrumb } from "@/components/relay/topbar";
import { CutButton } from "@/components/marketing/cut-button";

export const dynamic = "force-dynamic";

/**
 * The overview.
 *
 * Two states, and which one you get is decided by a single fact: does this
 * workspace have a relay key. Without one nothing can be captured, so showing
 * a dashboard of zeroes would be a worse answer than showing the one step that
 * makes the zeroes go away.
 */
export default async function AppOverviewPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const [projects, keys] = await Promise.all([
    listProjects(supabase, ctx.workspace.id).catch(() => []),
    listRelayKeys(supabase, ctx.workspace.id).catch(() => []),
  ]);

  const rosters = await Promise.all(
    projects.slice(0, 10).map((p) => listActiveAgents(admin, p.id).catch(() => [])),
  );
  const liveAgents = rosters.flat().filter((a) => a.status === "active").length;

  const needsSetup = keys.length === 0;

  return (
    <>
      <Topbar breadcrumb={<Breadcrumb segments={[{ label: "Overview" }]} />} />

      <div className="mx-auto flex w-full max-w-[1100px] flex-col px-6 pb-16">
        <PageHeader
          size="display"
          title={needsSetup ? "Set up the relay" : "Overview"}
          description={
            needsSetup
              ? "Your agents cannot log anything until this workspace has a relay key. It takes about a minute."
              : `${projects.length} project${projects.length === 1 ? "" : "s"}, ${liveAgents} agent${liveAgents === 1 ? "" : "s"} working right now.`
          }
        />

        {needsSetup ? (
          <ol className="flex flex-col divide-y divide-hairline overflow-hidden rounded-12 border border-hairline bg-raised">
            {[
              {
                n: "1",
                title: "Create a relay key",
                body: "One per machine. The settings page hands you the exact command to run.",
                cta: { label: "Create a key", href: "/app/settings/relay_keys" },
              },
              {
                n: "2",
                title: "Install the hooks",
                body: "Run poggle init inside a repository. It merges into your existing .claude/settings.json rather than replacing it.",
              },
              {
                n: "3",
                title: "Start an agent",
                body: "Nothing else changes. Capture and handoff happen without anyone doing anything.",
              },
            ].map((step) => (
              <li key={step.n} className="flex gap-5 px-6 py-5">
                <span className="t-mono-micro mt-1 flex size-[22px] shrink-0 items-center justify-center rounded-full border border-hairline text-ink-3">
                  {step.n}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="t-body-medium text-ink">{step.title}</span>
                  <p className="t-caption text-ink-2">{step.body}</p>
                  {step.cta ? (
                    <CutButton href={step.cta.href} className="mt-2 w-fit">
                      {step.cta.label}
                    </CutButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="t-label-caps text-ink-3">Projects</h2>
            {projects.length === 0 ? (
              <div className="rounded-12 border border-dashed border-hairline px-6 py-10 text-center">
                <p className="t-caption text-ink-3">
                  No projects yet. One appears the first time an agent logs an
                  event against a repository.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-12 border border-hairline bg-raised">
                {projects.slice(0, 8).map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/app/projects/${project.slug}`}
                      className="focus-ring-canvas flex items-center gap-5 px-6 py-4 outline-none transition-colors hover:bg-state-hover"
                    >
                      <span className="t-body-medium min-w-0 flex-1 truncate text-ink">
                        {project.name}
                      </span>
                      <span className="t-mono-micro shrink-0 text-ink-4">
                        {project.session_count} session
                        {project.session_count === 1 ? "" : "s"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/app/projects" className="t-link w-fit">
              All projects
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
