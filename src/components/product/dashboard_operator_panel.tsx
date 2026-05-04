"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { runWorkspaceOperatorAction } from "@/app/app/workspace_operator/actions";
import { useDashboardOperator } from "@/components/product/dashboard_plan_panel";

interface DashboardOperatorPanelProps {
  /**
   * The default box the agent is allowed to draft notes into. The dashboard
   * forwards `boxes[0]?.id` from the server render — when no box exists the
   * composer must not be rendered (the parent already gates on `hasBoxes`).
   */
  defaultBoxId: string;
}

const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: "Summarise this box",
    prompt: "Summarise the most recent activity in this box and surface the open questions.",
  },
  {
    label: "Find related notes",
    prompt: "Find notes across the workspace that relate to my recent work and propose links.",
  },
  {
    label: "Draft a follow-up",
    prompt: "Draft a follow-up note that captures the next steps from my last conversation.",
  },
];

/**
 * Inline operator composer rendered as the marquee affordance on the
 * dashboard. Reuses the existing `runWorkspaceOperatorAction` server action
 * — no new dispatch path. The textarea + chips are intentionally quiet:
 * one brand-yellow Run button anchors the composer.
 */
export function DashboardOperatorPanel({
  defaultBoxId,
}: DashboardOperatorPanelProps) {
  const router = useRouter();
  const { setPendingRunId, setMobileSheetOpen } = useDashboardOperator();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = prompt.trim();
  const canRun = trimmed.length > 0 && !isPending;

  function submit() {
    if (!canRun) return;
    setError(null);
    startTransition(async () => {
      const res = await runWorkspaceOperatorAction({
        prompt: trimmed,
        boxId: defaultBoxId,
      });
      if (!res.ok) {
        const msg =
          typeof res.error === "string"
            ? res.error
            : res.error.message ?? "Operator run failed.";
        setError(msg);
        return;
      }
      // Hand the new run id to the right-pane subscription. The dashboard
      // doesn't navigate away on submit anymore — the user watches the
      // plan stream in place. Power users can still click "Open run" from
      // the plan panel header to jump to the dedicated live view.
      setPendingRunId(res.data.run_id);
      setMobileSheetOpen(true);
      setPrompt("");
      // Refresh the server tree so the "Recent operator runs" section
      // and any related counters re-fetch on next paint.
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Workspace operator composer"
      className="rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask Poggle to organize, find, or build…"
        // Tighter min-height on mobile (don't waste vertical), full height on sm+.
        className="min-h-24 sm:min-h-32 resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:border-0"
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter to submit — matches every other composer in the app.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        disabled={isPending}
        aria-label="Ask Poggle"
      />

      {/* Quick prompts — horizontally-scrollable snap row on mobile, wraps to
          a flex-wrap grid at md+. The negative margin + matching padding lets
          chips bleed to the edge on small screens so the rightmost ones hint
          at horizontal overflow. */}
      <div
        className={
          "mt-4 -mx-1 flex snap-x gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
          "md:mx-0 md:flex-wrap md:items-center md:overflow-visible md:px-0"
        }
      >
        {QUICK_PROMPTS.map((chip) => (
          <Tooltip key={chip.label}>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setPrompt(chip.prompt)}
                  disabled={isPending}
                  // 44px tap target on mobile — matches shell guidance — and
                  // snaps into view as the user drags through suggestions.
                  className="h-11 shrink-0 snap-start md:h-8 md:shrink"
                />
              }
            >
              {chip.label}
            </TooltipTrigger>
            <TooltipContent>Insert prompt</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Run row — stacks on mobile (full-width Run), inlines at sm+. The
          "Saved prompts" link is secondary; on mobile it sits below the
          primary action so the brand-yellow Run anchors the composer. */}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <Button
          variant="ghost"
          size="lg"
          render={<Link href="/app/workspace_operator/prompts" />}
          className="h-11 w-full justify-center sm:w-auto sm:justify-start"
        >
          Saved prompts
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button
          variant="brand"
          size="lg"
          type="button"
          onClick={submit}
          disabled={!canRun}
          aria-label="Run operator"
          className="h-11 w-full sm:w-auto"
        >
          {isPending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Running
            </>
          ) : (
            "Run"
          )}
        </Button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Tip: press {/* OS-portable shorthand — keep it short */}
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
          ⌘
        </kbd>
        <span aria-hidden="true"> </span>
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
          Enter
        </kbd>{" "}
        to run.
      </p>
    </section>
  );
}
