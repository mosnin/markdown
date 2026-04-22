import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getSubagentInvocationById } from "@/server/repositories/subagent_invocation_repository";
import { PageHeader } from "@/components/product/page_header";

interface SubagentDetailPageProps {
  params: Promise<{ invocation_id: string }>;
}

export default async function SubagentDetailPage({
  params,
}: SubagentDetailPageProps) {
  const { invocation_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const invocation = await getSubagentInvocationById(supabase, invocation_id);
  if (!invocation || invocation.workspace_id !== ctx.workspace.id) {
    notFound();
  }

  // Hydrate skill name.
  const { data: skill } = await supabase
    .from("skills")
    .select("id, name, description")
    .eq("id", invocation.skill_id)
    .maybeSingle();

  const elapsed = invocation.completed_at
    ? new Date(invocation.completed_at).getTime() -
      new Date(invocation.started_at).getTime()
    : Date.now() - new Date(invocation.started_at).getTime();
  const elapsedSec = Math.round(elapsed / 1000);

  const totalTokens = invocation.input_tokens + invocation.output_tokens;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={skill?.name ?? "Sub-agent invocation"}
        description={`${invocation.status} · ${elapsedSec}s · ${totalTokens.toLocaleString()} tokens · ${invocation.tool_calls_count} tool calls`}
      />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
          <Link
            href="/app/sub_agents"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            All sub-agents
          </Link>

          <section aria-label="Invocation metadata" className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card px-4 py-3 text-xs">
            <MetaCell label="Status" value={invocation.status} />
            <MetaCell
              label="Started"
              value={new Date(invocation.started_at).toLocaleString("en-US")}
            />
            <MetaCell label="Depth" value={String(invocation.depth)} />
            <MetaCell
              label="Tool calls"
              value={String(invocation.tool_calls_count)}
            />
            <MetaCell
              label="Input tokens"
              value={invocation.input_tokens.toLocaleString()}
            />
            <MetaCell
              label="Output tokens"
              value={invocation.output_tokens.toLocaleString()}
            />
          </section>

          <section aria-label="Task prompt">
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Task
            </h2>
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <pre className="whitespace-pre-wrap break-words text-xs text-foreground/90">
                {invocation.task}
              </pre>
            </div>
          </section>

          {invocation.summary && (
            <section aria-label="Sub-agent summary">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Summary
              </h2>
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <pre className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {invocation.summary}
                </pre>
              </div>
            </section>
          )}

          {invocation.error && (
            <section aria-label="Error">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-rose-500">
                Error
              </h2>
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3">
                <pre className="whitespace-pre-wrap break-words text-xs text-rose-600">
                  {invocation.error}
                </pre>
              </div>
            </section>
          )}

          {skill && skill.description && (
            <section aria-label="Skill context">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Skill
              </h2>
              <Link
                href={`/app/skills/${invocation.skill_id}`}
                className="block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
              >
                <p className="text-sm font-medium text-foreground">
                  {skill.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {skill.description}
                </p>
              </Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}
