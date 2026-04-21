import { notFound } from "next/navigation";
import Link from "next/link";

import { Separator } from "@/components/ui/separator";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getOperatorRun } from "@/server/services/workspace_operator_runs_service";
import { listEventsForRun } from "@/server/services/operator_run_events_service";
import { RunReplayView } from "@/components/product/run_replay_view";
import type { ToolCallEvent } from "@/lib/hooks/use_operator_events";

/**
 * Persistent run replay page.
 *
 * Reconstructs the durable event stream of a past Operator run
 * (`operator_run_events` rows) and lets the user step / scrub through
 * every tool call, approval, and LLM call in agent-emission order.
 *
 * This is a strictly read-only historical view — no Realtime channels
 * are subscribed. Ownership is enforced at the page boundary to avoid
 * leaking the existence of another user's run.
 */

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default async function OperatorRunReplayPage({ params }: PageProps) {
  const { runId } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const run = await getOperatorRun(supabase, runId);
  if (!run) notFound();
  if (run.user_id !== ctx.user.id) notFound();
  if (run.workspace_id !== ctx.workspace.id) notFound();

  // Fetch the first page of events directly via the service — there's no
  // reason to hop through the HTTP route when we're already server-side
  // with an RLS-scoped supabase client.
  const firstPage = await listEventsForRun(supabase, {
    runId,
    afterSequence: 0,
    limit: 500,
  });

  // Rows come back as OperatorRunEventRow; the client component and
  // EnhancedEventStream both consume ToolCallEvent. The two shapes are
  // structurally compatible — cast here so the client component doesn't
  // need to know about the internal DB row type.
  const initialEvents = firstPage.rows as unknown as ToolCallEvent[];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-background">
        <div className="px-6 pt-6 pb-4">
          <Link
            href={`/app/workspace_operator/${runId}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Back to run summary
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Operator run replay
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Step-by-step playback of the durable event stream.
          </p>
        </div>
        <Separator />
      </div>

      <div className="flex-1 overflow-hidden">
        <RunReplayView
          runId={runId}
          run={run}
          initialEvents={initialEvents}
          initialNextCursor={firstPage.nextCursor}
        />
      </div>
    </div>
  );
}
