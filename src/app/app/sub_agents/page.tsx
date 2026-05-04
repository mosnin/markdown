// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import { Workflow } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { requireAdvancedSurfaces } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import { listRecentInvocationsByWorkspace } from "@/server/repositories/subagent_invocation_repository";
import { PageHeader } from "@/components/product/page_header";
import { SubagentInvocationRow } from "@/components/product/subagent_invocation_row";

export default async function SubagentsPage() {
  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
  const supabase = await createClient();
  const invocations = await listRecentInvocationsByWorkspace(
    supabase,
    ctx.workspace.id,
    { limit: 50 }
  );

  // Hydrate skill names for the rows. One round trip.
  const skillIds = Array.from(
    new Set(invocations.map((i) => i.skill_id))
  );
  const skillMap = new Map<string, string>();
  if (skillIds.length > 0) {
    const { data: skills } = await supabase
      .from("skills")
      .select("id, name")
      .in("id", skillIds);
    for (const s of skills ?? []) {
      skillMap.set(s.id as string, (s.name as string) ?? "");
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Sub-agents"
        description="Recent sub-agent invocations by Poggle and your agents. Each invocation runs in a fresh context window so orchestrator memory stays lean."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
          {invocations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <Workflow
                className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">
                No sub-agents invoked yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Turn on a skill&apos;s &ldquo;sub-agent&rdquo; toggle in the
                skill editor to make it callable by Poggle. Invocations will
                appear here.
              </p>
            </div>
          ) : (
            <section aria-label="Recent sub-agent invocations">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recent
                <span className="ml-2 text-[10px] font-normal opacity-70">
                  {invocations.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-1.5 list-none">
                {invocations.map((inv) => (
                  <li key={inv.id}>
                    <SubagentInvocationRow
                      invocation={inv}
                      skillName={skillMap.get(inv.skill_id) ?? null}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
