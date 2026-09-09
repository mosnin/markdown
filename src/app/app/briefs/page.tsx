import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listProjects } from "@/server/repositories/project_repository";
import { listHandoffBriefs } from "@/server/repositories/session_event_repository";
import { PageHeader } from "@/components/ui/page-header";
import { Topbar, Breadcrumb } from "@/components/relay/topbar";

export const dynamic = "force-dynamic";

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Every brief this workspace has handed out.
 *
 * The point of showing these to a person is not to read them — the agent read
 * it already. It is to check what the successor was actually told, which is
 * the only way to find out that the handoff was thin before you waste an hour
 * wondering why the next agent went the wrong way.
 *
 * So the body is shown verbatim, and the token count next to the budget is
 * shown too: a brief that came in far under budget usually means there was
 * little to say, and one that hit the ceiling means something was cut.
 */
export default async function BriefsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const projects = await listProjects(supabase, ctx.workspace.id).catch(() => []);

  const perProject = await Promise.all(
    projects.map(async (project) => ({
      project,
      briefs: await listHandoffBriefs(admin, project.id, { limit: 10 }).catch(
        () => [],
      ),
    })),
  );

  const withBriefs = perProject.filter((entry) => entry.briefs.length > 0);
  const total = withBriefs.reduce((n, entry) => n + entry.briefs.length, 0);

  return (
    <>
      <Topbar breadcrumb={<Breadcrumb segments={[{ label: "Handoff briefs" }]} />} />

      <div className="mx-auto flex w-full max-w-[1100px] flex-col px-6 pb-16">
        <PageHeader
          size="display"
          title="Handoff briefs"
          description={
            total > 0
              ? `${total} brief${total === 1 ? "" : "s"} handed to an incoming agent.`
              : "No briefs yet. One is assembled the moment an agent asks for context on a project that already has some."
          }
        />

        {withBriefs.length === 0 ? (
          <div className="rounded-12 border border-dashed border-hairline px-6 py-10 text-center">
            <p className="t-caption text-ink-3">
              A brief is built when an agent starts on a project with existing
              history — automatically at{" "}
              <span className="t-mono-micro text-ink-2">SessionStart</span>, or
              on demand with{" "}
              <span className="t-mono-micro text-ink-2">poggle brief</span>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            {withBriefs.map(({ project, briefs }) => (
              <section key={project.id} className="flex flex-col gap-4">
                <div className="flex items-baseline gap-3">
                  <h2 className="t-label-caps text-ink-3">{project.name}</h2>
                  <Link
                    href={`/app/projects/${project.slug}`}
                    className="t-link t-caption"
                  >
                    Open project
                  </Link>
                </div>

                <ul className="flex flex-col gap-4">
                  {briefs.map((brief) => (
                    <li
                      key={brief.id}
                      className="flex flex-col gap-4 rounded-12 border border-hairline bg-raised p-6"
                    >
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <span className="t-mono-micro text-ink-4">
                          {relative(brief.created_at)}
                        </span>
                        <span className="t-mono-micro text-ink-4">
                          {brief.token_estimate.toLocaleString("en-US")} /{" "}
                          {brief.budget_tokens.toLocaleString("en-US")} tokens
                        </span>
                        <span className="t-mono-micro text-ink-4">
                          {brief.source_session_ids.length} session
                          {brief.source_session_ids.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      {/* Verbatim: a paraphrased brief would defeat the point
                          of showing it, which is to see what was handed over. */}
                      <pre className="t-mono-micro max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-8 border border-hairline bg-inset p-4 text-ink-2">
                        {brief.body}
                      </pre>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
