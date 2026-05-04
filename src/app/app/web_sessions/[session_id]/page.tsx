// Soft-archived behind the `advanced_surfaces` feature flag (Move 4):
// default-tier users are redirected to /app; enterprise admins keep access.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { requireAdvancedSurfaces } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
import {
  getBrowsingSessionById,
  listStepsBySession,
} from "@/server/repositories/browsing_session_repository";
import { PageHeader } from "@/components/product/page_header";
import { WebSessionSteps } from "@/components/product/shell/web_session_steps";

interface SessionDetailPageProps {
  params: Promise<{ session_id: string }>;
}

export default async function SessionDetailPage({
  params,
}: SessionDetailPageProps) {
  const { session_id } = await params;
  const ctx = await requireAuthenticatedUser();
  await requireAdvancedSurfaces(ctx);
  const supabase = await createClient();

  const session = await getBrowsingSessionById(supabase, session_id);
  if (!session || session.workspace_id !== ctx.workspace.id) {
    notFound();
  }

  const steps = await listStepsBySession(supabase, session_id);

  const elapsed = session.completed_at
    ? new Date(session.completed_at).getTime() -
      new Date(session.started_at).getTime()
    : Date.now() - new Date(session.started_at).getTime();
  const elapsedSec = Math.round(elapsed / 1000);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={session.goal ?? "Browsing session"}
        description={`${session.page_count} ${session.page_count === 1 ? "step" : "steps"} · ${elapsedSec}s · $${(session.total_cost_cents / 100).toFixed(2)}`}
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/app/web_sessions"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All sessions
            </Link>
            {session.live_url && session.status === "active" && (
              <a
                href={session.live_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Watch live
              </a>
            )}
          </div>

          <section
            aria-label="Session metadata"
            className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card px-4 py-3 text-xs"
          >
            <MetaCell label="Status" value={session.status} />
            <MetaCell
              label="Started"
              value={new Date(session.started_at).toLocaleString("en-US")}
            />
            <MetaCell
              label="Pages"
              value={String(session.page_count)}
            />
            <MetaCell
              label="Cost"
              value={`$${(session.total_cost_cents / 100).toFixed(2)}`}
            />
            {session.error && (
              <div className="col-span-2">
                <MetaCell label="Error" value={session.error} error />
              </div>
            )}
          </section>

          <section aria-label="Session steps">
            <h2 className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Steps
            </h2>
            <WebSessionSteps steps={steps} />
          </section>
        </div>
      </div>
    </div>
  );
}

function MetaCell({
  label,
  value,
  error,
}: {
  label: string;
  value: string;
  error?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={`truncate ${error ? "text-rose-500" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
