import { Globe } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listSessionsByWorkspace } from "@/server/repositories/browsing_session_repository";
import { PageHeader } from "@/components/product/page_header";
import { WebSessionRow } from "@/components/product/shell/web_session_row";
import { WebBudgetCard } from "@/components/product/shell/web_budget_card";

export default async function WebSessionsPage() {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();
  const sessions = await listSessionsByWorkspace(supabase, ctx.workspace.id, {
    limit: 50,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Web sessions"
        description="Browsing and deep-research sessions run by Pog and your agents."
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
          <section
            aria-label="Monthly web tool budget"
            className="rounded-lg border border-border bg-card px-5 py-4"
          >
            <WebBudgetCard />
          </section>

          {sessions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <Globe
                className="mx-auto mb-3 h-6 w-6 text-muted-foreground/40"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">
                No browsing sessions yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                When Pog or an agent uses the browser to research something, the
                session will appear here.
              </p>
            </div>
          ) : (
            <section aria-label="Recent browsing sessions">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recent
                <span className="ml-2 text-[10px] font-normal opacity-70">
                  {sessions.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-1.5 list-none">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <WebSessionRow session={s} />
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
