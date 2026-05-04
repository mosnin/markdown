"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, Loader2, Sparkles, Wrench } from "lucide-react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DEMO_FALLBACK,
  DEMO_RESPONSES,
  type DemoResponse,
  type DemoToolCall,
} from "./_demo_responses";

// ---------------------------------------------------------------------------
// Run state machine
// ---------------------------------------------------------------------------

type RunState =
  | "idle"
  | "planning"
  | "tool_call"
  | "tool_call_2"
  | "tool_call_3"
  | "answering"
  | "done";

interface ResolvedRun {
  prompt: string;
  plan: string;
  toolCalls: readonly DemoToolCall[];
  answer: string;
  /** True when the prompt didn't match a canned transcript. */
  isFallback: boolean;
}

const STEP_DELAY_MS: Record<Exclude<RunState, "idle" | "done">, number> = {
  planning: 200,
  tool_call: 400,
  tool_call_2: 600,
  tool_call_3: 600,
  answering: 800,
};

// State ordering — used to pick "the next state" given the current one and
// the number of tool calls in the script (2 or 3).
const ORDER: RunState[] = [
  "planning",
  "tool_call",
  "tool_call_2",
  "tool_call_3",
  "answering",
  "done",
];

function nextState(current: RunState, toolCallCount: number): RunState {
  const idx = ORDER.indexOf(current);
  if (idx === -1) return "done";
  let candidate = ORDER[idx + 1] ?? "done";
  // Skip tool_call_3 when the run only has two tool calls.
  if (candidate === "tool_call_3" && toolCallCount < 3) {
    candidate = ORDER[idx + 2] ?? "done";
  }
  return candidate;
}

function resolvePrompt(raw: string): ResolvedRun {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const match = DEMO_RESPONSES.find(
    (r) =>
      lower === r.prompt.toLowerCase() || lower === r.label.toLowerCase(),
  );
  if (match) {
    return {
      prompt: match.prompt,
      plan: match.plan,
      toolCalls: match.toolCalls,
      answer: match.answer,
      isFallback: false,
    };
  }
  return {
    prompt: trimmed,
    plan: DEMO_FALLBACK.plan,
    toolCalls: DEMO_FALLBACK.toolCalls,
    answer: DEMO_FALLBACK.answer,
    isFallback: true,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LiveAgentDemoProps {
  className?: string;
}

/**
 * Inline live-agent demo for the marketing home page.
 *
 * A deterministic finite-state machine plays a canned agent run for each
 * suggested prompt — composer → planning → 2–3 tool calls → answer. Free-
 * form prompts fall back to a gentle redirect. Honors
 * `prefers-reduced-motion` by jumping straight to the final state.
 *
 * Self-contained: no server fetches, no auth, no imports from `src/server/`.
 */
export function LiveAgentDemo({ className }: LiveAgentDemoProps) {
  const reduceMotion = useReducedMotion();
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<RunState>("idle");
  const [run, setRun] = useState<ResolvedRun | null>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timeouts.current) clearTimeout(t);
    timeouts.current = [];
  }, []);

  // Cleanup on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(() => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return;
    clearTimers();

    const resolved = resolvePrompt(trimmed);
    setRun(resolved);

    // Reduced motion: skip the streaming reveal.
    if (reduceMotion) {
      setState("done");
      return;
    }

    // Otherwise advance through states with cumulative delays.
    setState("planning");
    let cursor: RunState = "planning";
    let cumulative = 0;
    while (cursor !== "done") {
      const upcoming = nextState(cursor, resolved.toolCalls.length);
      const delay = STEP_DELAY_MS[cursor as Exclude<RunState, "idle" | "done">];
      cumulative += delay;
      const target = upcoming;
      const t = setTimeout(() => setState(target), cumulative);
      timeouts.current.push(t);
      cursor = upcoming;
    }
  }, [prompt, reduceMotion, clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setRun(null);
    setState("idle");
  }, [clearTimers]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      start();
    }
  }

  const canRun = prompt.trim().length > 0 && state === "idle";
  const isRunning = state !== "idle" && state !== "done";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        "p-4 sm:p-6",
        className,
      )}
    >
      {/* Suggestions ─ */}
      <Suggestions
        disabled={isRunning}
        onPick={(p) => {
          if (isRunning) return;
          reset();
          setPrompt(p);
        }}
      />

      {/* Composer ─ */}
      <div className="mt-4">
        <label htmlFor="live-agent-demo-prompt" className="sr-only">
          Ask the demo agent
        </label>
        <Textarea
          id="live-agent-demo-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pick a suggestion above, or type one in…"
          className="min-h-[88px] resize-none text-[15px]"
          disabled={isRunning}
        />
        <div className="mt-3 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-muted-foreground/80">
            Demo runs against synthetic data. Sign up to use your own notes.
          </p>
          <div className="flex items-center justify-end gap-2">
            {state === "done" && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={reset}
              >
                Reset
              </Button>
            )}
            <Button
              variant="brand"
              size="sm"
              type="button"
              onClick={start}
              disabled={!canRun}
              aria-label="Run demo agent"
            >
              {isRunning ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Running
                </>
              ) : (
                "Run"
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Transcript ─ */}
      <Transcript state={state} run={run} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

function Suggestions({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  return (
    <div>
      <p className="text-overline text-muted-foreground/80">Try one of these</p>
      <div
        role="group"
        aria-label="Suggested prompts"
        className="mt-2 flex flex-wrap gap-2"
      >
        {DEMO_RESPONSES.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(r.prompt)}
            className={cn(
              "inline-flex h-8 items-center rounded-md border border-border bg-card px-3",
              "text-xs text-foreground",
              "transition-colors duration-150",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

function Transcript({
  state,
  run,
}: {
  state: RunState;
  run: ResolvedRun | null;
}) {
  // Idle — empty quiet placeholder so the box doesn't collapse on first paint.
  if (state === "idle" || run === null) {
    return (
      <div
        aria-live="polite"
        aria-atomic="false"
        className="mt-5 flex min-h-[140px] items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center"
      >
        <p className="text-sm text-muted-foreground">
          Pick a suggestion and press Run to watch a real agent run play out.
        </p>
      </div>
    );
  }

  // Compute which steps have started (for active/done styling).
  const stepIndex = ORDER.indexOf(state);
  const planActive = state === "planning";
  const planDone = stepIndex > ORDER.indexOf("planning");

  const visibleToolCallCount =
    state === "tool_call"
      ? 1
      : state === "tool_call_2"
        ? 2
        : state === "tool_call_3"
          ? 3
          : stepIndex > ORDER.indexOf("tool_call_3")
            ? run.toolCalls.length
            : 0;

  // Index of the actively-running tool call (so the chip can pulse).
  const activeToolCallIdx =
    state === "tool_call"
      ? 0
      : state === "tool_call_2"
        ? 1
        : state === "tool_call_3"
          ? 2
          : -1;

  const showAnswer = state === "answering" || state === "done";
  const answerActive = state === "answering";

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="mt-5 flex flex-col gap-3"
    >
      {/* User prompt bubble */}
      <UserPrompt prompt={run.prompt} />

      {/* Plan step */}
      <Step
        icon={<Sparkles aria-hidden="true" />}
        label="Thinking"
        active={planActive}
        done={planDone}
      >
        <p className="text-sm leading-relaxed text-foreground">{run.plan}</p>
      </Step>

      {/* Tool calls */}
      {visibleToolCallCount > 0 && (
        <Step
          icon={<Wrench aria-hidden="true" />}
          label="Tool calls"
          active={activeToolCallIdx >= 0}
          done={activeToolCallIdx === -1 && stepIndex >= ORDER.indexOf("answering")}
        >
          <ul className="flex flex-col gap-1.5">
            {run.toolCalls.slice(0, visibleToolCallCount).map((call, i) => {
              const isActive = i === activeToolCallIdx;
              return (
                <li
                  key={call.signature}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-1.5",
                    "sm:flex-row sm:items-center sm:gap-3",
                    isActive && "border-brand/40",
                  )}
                >
                  <code className="font-mono text-xs text-foreground break-all">
                    {call.signature}
                  </code>
                  <span className="ml-0 sm:ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {isActive ? (
                      <Loader2
                        className="size-3 animate-spin text-brand"
                        aria-hidden="true"
                      />
                    ) : (
                      <Check
                        className="size-3 text-success"
                        aria-hidden="true"
                      />
                    )}
                    <span className="font-mono">{call.result}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Step>
      )}

      {/* Final answer */}
      {showAnswer && (
        <Step
          icon={<Check aria-hidden="true" />}
          label="Answer"
          active={answerActive}
          done={state === "done"}
        >
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
            {run.answer}
          </p>
        </Step>
      )}
    </div>
  );
}

function UserPrompt({ prompt }: { prompt: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-medium text-muted-foreground"
      >
        You
      </span>
      <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2">
        <p className="text-sm leading-relaxed text-foreground">{prompt}</p>
      </div>
    </div>
  );
}

function Step({
  icon,
  label,
  active,
  done,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
          "transition-colors duration-150",
          active && "border-brand bg-brand text-brand-foreground",
          !active && done && "border-border bg-card text-muted-foreground",
          !active && !done && "border-border bg-card text-muted-foreground",
          "[&>svg]:size-3.5",
        )}
      >
        {active ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
      </span>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-overline mb-1.5",
            active ? "text-brand" : "text-muted-foreground/80",
          )}
        >
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}
