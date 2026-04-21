"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import {
  useOperatorEvents,
  useUsageFromEvents,
} from "@/lib/hooks/use_operator_events";
import type { WorkspaceOperatorRunRow } from "@/server/services/workspace_operator_runs_service";

import { PersonaSelector } from "@/components/product/persona_selector";
import { MemoryPanel } from "@/components/product/memory_panel";
import { PlanView, type RunPlanRow } from "@/components/product/plan_view";
import { ApprovalQueue } from "@/components/product/approval_queue";
import { EnhancedEventStream } from "@/components/product/enhanced_event_stream";
import { LiveTokenCounter } from "@/components/product/live_token_counter";
import { SteerInput } from "@/components/product/steer_input";
import { OperatorActivityPanel } from "@/components/product/operator_activity_panel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface OperatorLiveViewProps {
  runId: string;
  workspaceId: string;
  initialRun: WorkspaceOperatorRunRow;
  initialPlan: RunPlanRow | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROMPT_PREVIEW_MAX = 80;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function formatTokenCap(n: number | null): string {
  if (n == null) return "unlimited";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * OperatorLiveView — the full-page, three-column live workspace for a
 * running Operator invocation. The server component gates ownership and
 * redirects terminal runs; this component assumes the caller has already
 * confirmed the run belongs to the active workspace + user.
 *
 * Layout mirrors Claude Code: persona / config / memory on the left, event
 * stream + steering on the center, plan + approvals on the right. Each
 * column manages its own overflow; the page never scrolls globally.
 *
 * The mobile fallback delegates to {@link OperatorActivityPanel} which
 * already stacks the right set of components for narrow viewports.
 */
export function OperatorLiveView({
  runId,
  workspaceId,
  initialRun,
  initialPlan,
}: OperatorLiveViewProps) {
  const events = useOperatorEvents(runId);
  const usage = useUsageFromEvents(events);

  // Keep a live copy of the plan so edits reflect immediately in the UI —
  // PlanView's onEdited fires on successful saves.
  const [plan, setPlan] = useState<RunPlanRow | null>(initialPlan);

  const runIsActive = useMemo(() => {
    const s = initialRun.status;
    return s !== "completed" && s !== "failed" && s !== "cancelled";
  }, [initialRun.status]);

  const planEditable = initialRun.status === "awaiting_approval";
  const promptPreview = truncate(initialRun.prompt, PROMPT_PREVIEW_MAX);

  // TODO: persona_slug is not yet on WorkspaceOperatorRunRow. Once the
  // row gains the column, thread it through here so the selector shows
  // the persona the run was launched with.
  const personaValue: string | null = null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-background">
        <div className="flex items-center gap-4 px-6 pt-4 pb-3">
          <Link
            href="/app/workspace_operator"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to run history
          </Link>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-sm font-medium text-foreground"
              title={initialRun.prompt}
            >
              {promptPreview}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono">run {runId.slice(0, 8)}…</span>
              <span aria-hidden="true">·</span>
              <span className="uppercase tracking-wide">{initialRun.status}</span>
            </div>
          </div>
          <div className="shrink-0">
            <LiveTokenCounter
              inputTokens={usage.inputTokens}
              outputTokens={usage.outputTokens}
              maxInputTokens={initialRun.max_input_tokens ?? null}
              maxOutputTokens={initialRun.max_output_tokens ?? null}
              model={initialRun.model ?? null}
            />
          </div>
        </div>
        <Separator />
      </header>

      {/* ─── Desktop: three-column grid ─────────────────────────────────── */}
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[320px_minmax(0,1fr)_380px]">
        {/* LEFT — persona / config / memory */}
        <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-border">
          <section className="flex flex-col gap-2 px-4 pt-4 pb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Persona
            </h2>
            <PersonaSelector
              workspaceId={workspaceId}
              value={personaValue}
              onChange={() => {
                /* locked after run start — no-op */
              }}
              disabled
            />
            <p className="text-[11px] text-muted-foreground">
              Persona is locked once the run has started.
            </p>
          </section>

          <Separator />

          <section className="flex flex-col gap-2 px-4 pt-4 pb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Run config
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Mode</dt>
              <dd className="font-mono text-foreground">{initialRun.mode}</dd>
              <dt className="text-muted-foreground">Model</dt>
              <dd className="truncate font-mono text-foreground">
                {initialRun.model ?? "default"}
              </dd>
              <dt className="text-muted-foreground">Max input</dt>
              <dd className="font-mono text-foreground">
                {formatTokenCap(initialRun.max_input_tokens)}
              </dd>
              <dt className="text-muted-foreground">Max output</dt>
              <dd className="font-mono text-foreground">
                {formatTokenCap(initialRun.max_output_tokens)}
              </dd>
            </dl>
          </section>

          <Separator />

          <section className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-4 pb-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Memory
            </h2>
            <div className="min-h-0 flex-1">
              <MemoryPanel workspaceId={workspaceId} />
            </div>
          </section>
        </aside>

        {/* CENTER — event stream + steer */}
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="border-b border-border px-4 py-2">
            <div
              className="truncate text-xs text-muted-foreground"
              title={initialRun.prompt}
            >
              <span className="mr-1 font-semibold text-foreground">
                Prompt:
              </span>
              {promptPreview}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <EnhancedEventStream events={events} autoScroll />
          </div>

          <div className="border-t border-border p-3">
            <SteerInput runId={runId} enabled={runIsActive} />
          </div>
        </section>

        {/* RIGHT — plan + approvals */}
        <aside className="flex min-h-0 flex-col border-l border-border">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <section className="flex flex-col gap-2 px-4 pt-4 pb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Plan
              </h2>
              <PlanView
                runId={runId}
                plan={plan}
                editable={planEditable}
                onApproved={() => {
                  /* plan-row approval state will surface via events; no
                   * local refresh required here */
                }}
                onEdited={(next) => setPlan(next)}
              />
            </section>
          </div>

          <Separator />

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <section className="flex flex-col gap-2 px-4 pt-4 pb-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Approvals
              </h2>
              <ApprovalQueue runId={runId} />
            </section>
          </div>
        </aside>
      </div>

      {/* ─── Mobile: stacked activity panel ─────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <OperatorActivityPanel
          runId={runId}
          runIsActive={runIsActive}
          maxInputTokens={initialRun.max_input_tokens ?? null}
          maxOutputTokens={initialRun.max_output_tokens ?? null}
          model={initialRun.model ?? null}
        />
      </div>
    </div>
  );
}
