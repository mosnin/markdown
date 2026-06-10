"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Play,
  CheckCircle2,
  XCircle,
  ArrowRight,
  RotateCcw,
  Sparkles,
  BadgeAlert,
  Save,
  Maximize2,
  PanelLeftClose,
  PanelLeft,
  Layers,
  Quote,
  Zap,
  ArrowUp,
  BookOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import * as m from "motion/react-m";
import { AnimatePresence } from "motion/react";
import { fadeRise } from "@/lib/motion";
import { useOperatorProgress } from "@/lib/hooks/use_operator_run";
import { OperatorActivityPanel } from "@/components/product/operator/operator_activity_panel";
import { OperatorSessionsSidebar } from "@/components/product/operator/operator_sessions_sidebar";
import { OperatorSessionHistory } from "@/components/product/operator/operator_session_history";
import type { OperatorSession } from "@/server/services/operator_sessions_service";
import {
  requestOperatorPlanAction,
  approveAndExecuteAction,
  runWorkspaceOperatorAction,
  cancelRunAction,
  retryRunAction,
  listSavedPromptsAction,
  saveOperatorPromptAction,
  type ActionErrorQuotaExceeded,
} from "@/app/app/workspace_operator/actions";
import { loadOperatorQuotaAction } from "@/app/app/workspace_operator/quota_actions";
import type {
  OperatorPlanStep,
  OperatorRunPhase,
  OperatorProgressEvent,
  SavedOperatorPrompt,
  OperatorModel,
} from "@/app/app/workspace_operator/types";
import {
  OPERATOR_MODELS,
  DEFAULT_OPERATOR_MODEL,
  estimateOperatorRunCost,
  formatOperatorCostUsd,
} from "@/app/app/workspace_operator/types";
import type { WorkspacePlan } from "@/server/services/subscription_service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OperatorPanelProps {
  /** "sheet" (default) slides in as a right-side drawer. "page" renders inline at full height. */
  mode?: "sheet" | "page";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultBoxId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_BADGE_STYLES: Record<string, string> = {
  hybrid_search: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  draft_note: "bg-green-500/10 text-green-600 dark:text-green-400",
  analysis: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

function toolBadgeClass(tool: string): string {
  return TOOL_BADGE_STYLES[tool] ?? "bg-muted text-muted-foreground";
}

function stepStatusIcon(status: OperatorPlanStep["status"]) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400"
          aria-label="Completed"
        />
      );
    case "in_progress":
      return <Spinner size={16} />;
    case "failed":
      return (
        <XCircle
          className="h-4 w-4 shrink-0 text-destructive"
          aria-label="Failed"
        />
      );
    case "pending":
    default:
      return (
        <div
          className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/30"
          aria-label="Pending"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MAX_PROMPT_LENGTH = 4000;

/** UI-facing slice of a structured quota-exceeded error — the panel
 *  persists this so its `quota_exceeded` phase can show tier / reset
 *  messaging without re-fetching. */
interface QuotaExceededState {
  tier: WorkspacePlan;
  limit: number | null;
  used: number;
  resetsAt: string;
  message: string;
}

/** Proactive pre-check snapshot used to disable the submit button. */
interface QuotaPreview {
  tier: WorkspacePlan;
  limit: number | null;
  used: number;
  remaining: number;
  allowed: boolean;
  resetsAt: string;
}

export function OperatorPanel({
  mode = "sheet",
  open = false,
  onOpenChange = () => {},
  defaultBoxId,
}: OperatorPanelProps) {
  // -- state -----------------------------------------------------------------
  const [phase, setPhase] = useState<OperatorRunPhase>("idle");
  const [prompt, setPrompt] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [steps, setSteps] = useState<OperatorPlanStep[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    notes_created: string[];
    tool_calls: number;
    error?: string | null;
  } | null>(null);
  const [quotaExceeded, setQuotaExceeded] =
    useState<QuotaExceededState | null>(null);
  const [quotaPreview, setQuotaPreview] = useState<QuotaPreview | null>(null);

  // Wave 2 — model picker, saved prompts, save dialog, cancel-in-flight.
  const [selectedModel, setSelectedModel] = useState<OperatorModel>(
    DEFAULT_OPERATOR_MODEL
  );
  const [savedPrompts, setSavedPrompts] = useState<SavedOperatorPrompt[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [varsDialog, setVarsDialog] = useState<{
    template: string;
    variables: string[];
    values: Record<string, string>;
  } | null>(null);
  const [requireCitations, setRequireCitations] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const [isPlanPending, startPlanTransition] = useTransition();
  const [isExecPending, startExecTransition] = useTransition();

  // Session management — Codex-style thread isolation.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionHistoryRefreshKey, setSessionHistoryRefreshKey] = useState(0);
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(true);

  // Prompt-history recall state. `historyIndex === -1` means "not recalling"
  // (the textarea contents are user-typed, not a recalled entry). Any other
  // value is a 0-based index into `promptHistory` (most-recent first).
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Subscribe to live progress broadcast channel for any non-terminal phase
  // where the agent may still be pushing events. We still only *have* a runId
  // once planning returns — the hook no-ops when runId is null, so the list
  // stays empty in phases like "idle" / "quota_exceeded" / "failed".
  //
  // The hook also auto-tears down when `runId` changes to null (e.g. on
  // panel close via reset()) — see `use_operator_run.ts`.
  const isActivePhase =
    phase === "planning" ||
    phase === "awaiting_approval" ||
    phase === "executing";
  const progressEvents = useOperatorProgress(isActivePhase ? runId : null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Last N live events to render in the little log beneath the plan / steps.
  const LIVE_LOG_TAIL = 8;
  const liveTail = useMemo(
    () => progressEvents.slice(-LIVE_LOG_TAIL),
    [progressEvents]
  );

  // -- quota preload ---------------------------------------------------------
  // Load the current quota when the panel opens so the submit button can
  // be preemptively disabled at limit with a tooltip. Re-fetch after a
  // completed run so a user who was at 4/5 sees the reflected 5/5.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadOperatorQuotaAction().then((res) => {
      if (cancelled || !res.ok || !res.quota) return;
      setQuotaPreview({
        tier: res.quota.tier,
        limit: res.quota.limit,
        used: res.quota.used,
        remaining: res.quota.remaining,
        allowed: res.quota.allowed,
        resetsAt:
          res.quota.resetsAt instanceof Date
            ? res.quota.resetsAt.toISOString()
            : String(res.quota.resetsAt),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, phase]);

  // Load saved prompts when the panel opens. Errors here are non-fatal —
  // the dropdown just shows nothing and the user can still type free-form.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listSavedPromptsAction().then((res) => {
      if (cancelled || !res.ok) return;
      setSavedPrompts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Pick up a prompt stashed in sessionStorage by the "Try an example"
  // chips on the history page. Consumed once per open so re-opening an
  // idle panel doesn't overwrite the user's in-progress text.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    try {
      const pending = window.sessionStorage.getItem("poggle:pending-prompt");
      if (pending) {
        setPrompt(pending.slice(0, MAX_PROMPT_LENGTH));
        window.sessionStorage.removeItem("poggle:pending-prompt");
      }
    } catch {
      // sessionStorage blocked — nothing to pick up.
    }
  }, [open]);

  // -- derived ---------------------------------------------------------------
  const boxId = defaultBoxId ?? "";

  // Prompt-history key is scoped by boxId (the panel's closest workspace
  // discriminator available here); the trigger forwards the active
  // workspace's box so prompts don't bleed across workspaces on a shared
  // device.
  const promptHistoryKey = boxId
    ? `${PROMPT_HISTORY_KEY_PREFIX}${boxId}`
    : null;

  // Load prompt history from localStorage once per workspace scope.
  useEffect(() => {
    if (!open || !promptHistoryKey || typeof window === "undefined") return;
    const loaded = loadPromptHistory(window.localStorage, promptHistoryKey);
    setPromptHistory(loaded);
  }, [open, promptHistoryKey]);

  // Tear down the progress subscription when the panel closes. We do this
  // by clearing runId — the `useOperatorProgress` hook keys off runId and
  // removes its Supabase channel when runId transitions to null. We keep
  // the run otherwise viable (no reset of prompt/steps) so reopening the
  // panel mid-run later would still benefit from a manual refresh.
  useEffect(() => {
    if (open) return;
    if (phase === "completed" || phase === "failed" || phase === "cancelled") {
      // Terminal state — it's fine to drop runId entirely on close.
      setRunId(null);
    }
  }, [open, phase]);

  // Pro/Business may opt into the bigger model. Free is locked to mini.
  const canUseLargeModel =
    quotaPreview?.tier === "pro" || quotaPreview?.tier === "business";

  // -- effects ---------------------------------------------------------------

  // Scroll event log to bottom when new events arrive.
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressEvents.length]);

  // Update step statuses from realtime progress events.
  useEffect(() => {
    if (phase !== "executing" || progressEvents.length === 0) return;

    const latest = progressEvents[progressEvents.length - 1];

    if (latest.type === "step_start" && latest.step_index != null) {
      setSteps((prev) =>
        prev.map((s) =>
          s.index === latest.step_index ? { ...s, status: "in_progress" } : s
        )
      );
    }

    if (latest.type === "step_complete" && latest.step_index != null) {
      setSteps((prev) =>
        prev.map((s) =>
          s.index === latest.step_index ? { ...s, status: "completed" } : s
        )
      );
    }

    if (latest.type === "failed") {
      // Mark any in-progress step as failed.
      setSteps((prev) =>
        prev.map((s) =>
          s.status === "in_progress" ? { ...s, status: "failed" } : s
        )
      );
    }
  }, [phase, progressEvents]);

  // -- handlers --------------------------------------------------------------

  function reset() {
    setPhase("idle");
    setPrompt("");
    setRunId(null);
    setBranchId(null);
    setSteps([]);
    setSummary("");
    setError(null);
    setResult(null);
    setQuotaExceeded(null);
    setCancelling(false);
    setRetrying(false);
  }

  function handleGeneratePlan() {
    if (!prompt.trim() || !boxId) return;

    // Persist the submitted prompt into the per-workspace ring buffer so
    // the user can recall it with Up/Down on future runs. Dedupes adjacent
    // duplicates and caps at PROMPT_HISTORY_MAX entries.
    if (promptHistoryKey && typeof window !== "undefined") {
      const next = pushPromptHistory(promptHistory, prompt.trim());
      setPromptHistory(next);
      savePromptHistory(window.localStorage, promptHistoryKey, next);
    }
    setHistoryIndex(-1);

    setError(null);
    setPhase("planning");

    const submittedPrompt = decoratePrompt(prompt.trim(), { requireCitations });

    // Auto mode — skip the plan/approve gate and go straight from prompt
    // to execution. The plan phase is valuable for complex requests but is
    // pure ceremony for simple one-shot prompts; power users opt into
    // auto mode to cut the round-trip.
    if (autoMode) {
      setPhase("executing");
      startExecTransition(async () => {
        const res = await runWorkspaceOperatorAction({
          prompt: submittedPrompt,
          boxId,
          model: selectedModel,
          sessionId: activeSessionId,
        });
        if (!res.ok) {
          if (isQuotaError(res.error)) {
            setQuotaExceeded({
              tier: res.error.tier,
              limit: res.error.limit,
              used: res.error.used,
              resetsAt: res.error.resetsAt,
              message: res.error.message,
            });
            setPhase("quota_exceeded");
            return;
          }
          setError(
            typeof res.error === "string"
              ? res.error
              : (res.error as { message: string }).message
          );
          setPhase("failed");
          return;
        }
        setRunId(res.data.run_id);
        setBranchId(res.data.branch_id);
        setResult({
          notes_created: res.data.notes_created,
          tool_calls: res.data.tool_calls,
          error: res.data.error,
        });
        if (res.data.status === "completed") {
          setPhase("completed");
          setSessionHistoryRefreshKey((k) => k + 1);
        } else {
          setError(res.data.error ?? "Execution failed.");
          setPhase("failed");
        }
      });
      return;
    }

    startPlanTransition(async () => {
      const res = await requestOperatorPlanAction({
        prompt: submittedPrompt,
        boxId,
        model: selectedModel,
        sessionId: activeSessionId,
      });

      if (!res.ok) {
        if (isQuotaError(res.error)) {
          setQuotaExceeded({
            tier: res.error.tier,
            limit: res.error.limit,
            used: res.error.used,
            resetsAt: res.error.resetsAt,
            message: res.error.message,
          });
          setPhase("quota_exceeded");
          return;
        }
        setError(
          typeof res.error === "string"
            ? res.error
            : (res.error as { message: string }).message
        );
        setPhase("failed");
        return;
      }

      setRunId(res.data.run_id);
      setBranchId(res.data.branch_id);
      setSteps(res.data.steps);
      setSummary(res.data.summary);
      setPhase("awaiting_approval");
    });
  }

  function handleApproveAndRun() {
    if (!runId || !branchId || steps.length === 0) return;

    setError(null);
    setPhase("executing");

    startExecTransition(async () => {
      const editedSteps = steps.map((s) => ({
        index: s.index,
        description: s.description,
        tool: s.tool,
      }));
      const res = await approveAndExecuteAction({
        runId: runId!,
        branchId: branchId!,
        boxId,
        prompt: decoratePrompt(prompt.trim(), { requireCitations }),
        steps: editedSteps,
        editedSteps,
        model: selectedModel,
      });

      if (!res.ok) {
        if (isQuotaError(res.error)) {
          setQuotaExceeded({
            tier: res.error.tier,
            limit: res.error.limit,
            used: res.error.used,
            resetsAt: res.error.resetsAt,
            message: res.error.message,
          });
          setPhase("quota_exceeded");
          return;
        }
        setError(
          typeof res.error === "string"
            ? res.error
            : (res.error as { message: string }).message
        );
        setPhase("failed");
        return;
      }

      setResult({
        notes_created: res.data.notes_created,
        tool_calls: res.data.tool_calls,
        error: res.data.error,
      });

      if (res.data.status === "completed") {
        setPhase("completed");
        setSessionHistoryRefreshKey((k) => k + 1);
      } else {
        setError(res.data.error ?? "Execution failed.");
        setPhase("failed");
      }
    });
  }

  /**
   * Real cancel — signals the Modal-side agent to stop via cancelRunAction.
   *
   * Optimistically transitions to "cancelled" after the action returns.
   * The Python operator polls cancellation_requested_at and writes the
   * final status; the panel's state is just a UI hint until then.
   *
   * If we have no runId yet (e.g. action hasn't returned the dispatch id),
   * fall back to a local-only reset — there's nothing server-side to stop.
   */
  function handleCancel() {
    if (!runId) {
      reset();
      return;
    }
    setCancelling(true);
    setError(null);
    cancelRunAction(runId)
      .then((res) => {
        if (!res.ok) {
          setError(actionErrorToString(res.error, "Failed to cancel."));
          setCancelling(false);
          return;
        }
        setPhase("cancelled");
        setCancelling(false);
        // Brief beat so the user sees the "cancelled" state, then reset.
        setTimeout(reset, 1200);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to cancel.");
        setCancelling(false);
      });
  }

  /**
   * Retry a failed run — mints a new runs row server-side via retryRunAction
   * and re-enters the planning/executing phase. The panel reseeds prompt +
   * model + branch from the new row so the user can also edit before
   * re-approving (when the original mode was "execute" or "plan").
   */
  function handleRetry() {
    if (!runId) {
      reset();
      return;
    }
    setRetrying(true);
    setError(null);
    retryRunAction(runId)
      .then((res) => {
        if (!res.ok) {
          setError(actionErrorToString(res.error, "Failed to retry."));
          setRetrying(false);
          return;
        }
        // Reseed from the new run row.
        setRunId(res.data.newRunId);
        setBranchId(res.data.branchId);
        setPrompt(res.data.prompt);
        if (res.data.model) {
          setSelectedModel(
            (OPERATOR_MODELS as readonly string[]).includes(res.data.model)
              ? (res.data.model as OperatorModel)
              : DEFAULT_OPERATOR_MODEL
          );
        }
        setSteps([]);
        setSummary("");
        setResult(null);
        setRetrying(false);
        // For plan/execute modes: drop back to idle so the user can re-plan.
        // For full mode: kick off a fresh plan automatically. Without
        // auto-dispatch we'd silently strand the new run id; explicit
        // re-plan keeps quota gating + audit consistent.
        if (res.data.mode === "full" || res.data.mode === "plan") {
          setPhase("idle");
        } else {
          setPhase("idle");
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to retry.");
        setRetrying(false);
      });
  }

  function handleStepDescriptionChange(index: number, value: string) {
    setSteps((prev) =>
      prev.map((s) => (s.index === index ? { ...s, description: value } : s))
    );
  }

  // -- keyboard shortcuts ----------------------------------------------------

  // Cancel is only meaningful while the run is still in-flight server-side
  // (planning or executing). `awaiting_approval` hasn't dispatched anything
  // yet — Esc there would nuke local state, which reset() already handles.
  const isCancellable =
    phase === "planning" || phase === "executing";

  const handleCancelRef = useRef(handleCancel);
  const handleGeneratePlanRef = useRef(handleGeneratePlan);
  handleCancelRef.current = handleCancel;
  handleGeneratePlanRef.current = handleGeneratePlan;

  // Cmd/Ctrl+K is owned by the global CommandPalette (see
  // CommandPaletteProvider), not the operator panel — binding it here too made
  // the shortcut open the command palette and this sheet at the same time. The
  // panel stays reachable via its trigger button and the OPEN_OPERATOR_EVENT.

  // Esc while a cancellable run is running: send cancel. Only active when
  // the panel is open so it doesn't stomp on other "Esc" handlers elsewhere
  // in the app.
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!isCancellable) return;
      if (cancelling) return;
      // Only intercept when the Sheet is the focused surface — a nested
      // Dialog (e.g. save-template) should get its own Esc.
      if (saveDialogOpen) return;
      e.preventDefault();
      handleCancelRef.current();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, isCancellable, cancelling, saveDialogOpen]);

  /**
   * Textarea keydown — supports three shortcuts:
   *
   *   - Cmd/Ctrl+Enter   → submit (same as clicking Generate Plan)
   *   - Up (at start)    → recall previous prompt in history
   *   - Down (at start)  → recall next prompt (or clear back to empty)
   *   - Esc              → clear recall and return to an empty textarea
   *
   * Up/Down only intercept when the cursor is at position 0 AND either the
   * textarea is empty OR the user is currently viewing a recalled entry.
   * Without those guards, Up/Down would break vertical line navigation
   * inside a multi-line user-typed prompt.
   */
  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && e.key === "Enter") {
        e.preventDefault();
        handleGeneratePlanRef.current();
        return;
      }

      const target = e.currentTarget;
      const atStart =
        target.selectionStart === 0 && target.selectionEnd === 0;
      const isRecalling = historyIndex !== -1;
      const emptyOrRecalling = target.value.length === 0 || isRecalling;

      if (e.key === "ArrowUp" && atStart && emptyOrRecalling) {
        if (promptHistory.length === 0) return;
        const nextIdx = Math.min(historyIndex + 1, promptHistory.length - 1);
        if (nextIdx === historyIndex) return;
        e.preventDefault();
        setHistoryIndex(nextIdx);
        setPrompt(promptHistory[nextIdx].slice(0, MAX_PROMPT_LENGTH));
        return;
      }

      if (e.key === "ArrowDown" && atStart && emptyOrRecalling) {
        if (!isRecalling) return;
        const nextIdx = historyIndex - 1;
        e.preventDefault();
        if (nextIdx < 0) {
          setHistoryIndex(-1);
          setPrompt("");
        } else {
          setHistoryIndex(nextIdx);
          setPrompt(promptHistory[nextIdx].slice(0, MAX_PROMPT_LENGTH));
        }
        return;
      }

      if (e.key === "Escape" && isRecalling) {
        e.preventDefault();
        setHistoryIndex(-1);
        setPrompt("");
      }
    },
    [historyIndex, promptHistory]
  );

  function handleSelectSavedPrompt(id: string) {
    if (!id) return;
    const found = savedPrompts.find((p) => p.id === id);
    if (!found) return;
    const variables = extractPromptVariables(found.prompt);
    if (variables.length === 0) {
      setPrompt(found.prompt.slice(0, MAX_PROMPT_LENGTH));
      return;
    }
    const initialValues: Record<string, string> = {};
    for (const name of variables) initialValues[name] = "";
    setVarsDialog({
      template: found.prompt,
      variables,
      values: initialValues,
    });
  }

  function handleApplyVariables() {
    if (!varsDialog) return;
    const filled = applyPromptVariables(varsDialog.template, varsDialog.values);
    setPrompt(filled.slice(0, MAX_PROMPT_LENGTH));
    setVarsDialog(null);
  }

  function handleOpenSaveDialog() {
    if (!prompt.trim()) return;
    setSaveError(null);
    setSaveName("");
    setSaveDialogOpen(true);
  }

  function handleSaveTemplate() {
    if (!saveName.trim() || !prompt.trim()) {
      setSaveError("Name and prompt are required.");
      return;
    }
    setSaveError(null);
    saveOperatorPromptAction({
      name: saveName.trim(),
      prompt: prompt.trim(),
    }).then((res) => {
      if (!res.ok) {
        setSaveError(actionErrorToString(res.error, "Failed to save prompt."));
        return;
      }
      setSavedPrompts((prev) => [res.data, ...prev]);
      setSaveDialogOpen(false);
    });
  }

  // -- render helpers --------------------------------------------------------

  const [savedPromptsOpen, setSavedPromptsOpen] = useState(false);

  function renderIdle() {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Session history — keep existing code, unchanged */}
        {activeSessionId && (
          <div className="flex flex-col gap-1 p-4 pb-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              This session
            </p>
            <div className="rounded-md border border-border overflow-hidden">
              <OperatorSessionHistory
                sessionId={activeSessionId}
                activeRunId={runId}
                refreshKey={sessionHistoryRefreshKey}
              />
            </div>
          </div>
        )}

        {/* Spacer that pushes composer to bottom */}
        <div className="flex-1" />

        {/* Composer area */}
        <div className="flex flex-col gap-2 border-t border-border p-4">
          {/* Context chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Collection chip — shows defaultBoxId if set */}
            {defaultBoxId && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                <Layers className="h-3 w-3" />
                Collection
              </span>
            )}
            {/* Citations toggle chip */}
            <button
              type="button"
              onClick={() => setRequireCitations((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                requireCitations
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted/50 text-muted-foreground hover:text-foreground"
              )}
            >
              <Quote className="h-3 w-3" />
              Cite sources
            </button>
            {/* Auto-run chip */}
            <button
              type="button"
              onClick={() => setAutoMode((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                autoMode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted/50 text-muted-foreground hover:text-foreground"
              )}
            >
              <Zap className="h-3 w-3" />
              Auto run
            </button>
            {/* Templates chip — only shown when saved prompts exist */}
            {savedPrompts.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSavedPromptsOpen((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    savedPromptsOpen
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted/50 text-muted-foreground hover:text-foreground"
                  )}
                  aria-label="Templates"
                >
                  <BookOpen className="h-3 w-3" />
                  Templates
                </button>
                {savedPromptsOpen && (
                  <div className="absolute bottom-full left-0 mb-1 z-10 min-w-[200px] rounded-md border border-border bg-background shadow-md">
                    <div className="flex flex-col py-1">
                      {savedPrompts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            handleSelectSavedPrompt(p.id);
                            setSavedPromptsOpen(false);
                          }}
                          className="px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent truncate"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Save as template button */}
            <button
              type="button"
              onClick={handleOpenSaveDialog}
              disabled={!prompt.trim()}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Save as template"
            >
              <Save className="h-3 w-3" />
              Save
            </button>
          </div>

          {/* Textarea */}
          <div className="relative">
            <Textarea
              id="operator-prompt"
              ref={promptTextareaRef}
              placeholder="Research, write, or organize your notes..."
              value={prompt}
              onChange={(e) => {
                if (historyIndex !== -1) setHistoryIndex(-1);
                setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH));
              }}
              onKeyDown={handlePromptKeyDown}
              maxLength={MAX_PROMPT_LENGTH}
              className="min-h-[80px] resize-none pr-16 text-sm rounded-md"
              aria-describedby="operator-prompt-shortcuts"
            />
            {/* Send button — overlaid bottom-right of textarea */}
            <Button
              size="sm"
              disabled={
                !prompt.trim() ||
                !boxId ||
                isPlanPending ||
                isExecPending ||
                (quotaPreview !== null && !quotaPreview.allowed)
              }
              onClick={handleGeneratePlan}
              className="absolute bottom-2 right-2 h-7 w-7 p-0"
              title={
                quotaPreview !== null && !quotaPreview.allowed
                  ? `You've used all ${quotaPreview.limit ?? "∞"} Operator runs on the ${quotaPreview.tier} tier this month. Resets on ${formatResetDate(quotaPreview.resetsAt)}.`
                  : autoMode ? "Run now" : "Generate plan"
              }
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Bottom metadata row */}
          <div className="flex items-center justify-between">
            <p id="operator-prompt-shortcuts" className="text-[10px] text-muted-foreground/60">
              {autoMode ? "↵ runs immediately" : "↵ generates a plan to review"}
            </p>
            {quotaPreview && !quotaPreview.allowed && (
              <p className="text-[10px] text-destructive">Quota reached</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderQuotaExceeded() {
    const q = quotaExceeded;
    if (!q) return null;
    const tierLabel =
      q.tier === "business"
        ? "Business"
        : q.tier === "pro"
          ? "Pro"
          : "Free";
    const canUpgrade = q.tier !== "business";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <BadgeAlert
          className="h-10 w-10 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            {q.limit == null
              ? `You've reached your Operator limit on the ${tierLabel} tier this month.`
              : `You've used all ${q.limit} Operator runs on the ${tierLabel} tier this month.`}
          </p>
          <p className="text-xs text-muted-foreground">
            Resets on {formatResetDate(q.resetsAt)}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canUpgrade && (
            <Button render={<Link href="/app/settings#settings-billing" />}>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              Upgrade plan
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Close
          </Button>
        </div>
      </div>
    );
  }

  function renderPlanning() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
        <Spinner size={24} />
        <p className="text-sm text-muted-foreground">Generating plan...</p>
      </div>
    );
  }

  function renderAwaitingApproval() {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        {summary && (
          <p className="text-sm text-muted-foreground">{summary}</p>
        )}

        {liveTail.length > 0 && (
          <ul
            className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/30 p-2"
            aria-label="Live operator events"
          >
            {liveTail.map((evt, i) => (
              <li
                // Event stream is append-only; timestamp + type + step_index
                // uniquely identify each event, with `i` as a tiebreaker.
                key={`tail-${evt.timestamp}-${evt.type}-${evt.step_index ?? "x"}-${i}`}
                className="flex items-start gap-2 text-[10px] text-muted-foreground"
              >
                <span className="shrink-0 tabular-nums">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
                <span className="truncate">{formatEventDetail(evt)}</span>
              </li>
            ))}
          </ul>
        )}

        <Separator />

        <ScrollArea className="flex-1 -mx-4 px-4">
          <ol className="flex flex-col gap-2" aria-label="Plan steps">
            <AnimatePresence initial={false}>
              {steps.map((step) => (
                <m.li
                  key={step.index}
                  variants={fadeRise}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {step.index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input
                      type="text"
                      value={step.description}
                      onChange={(e) =>
                        handleStepDescriptionChange(step.index, e.target.value)
                      }
                      className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus:underline"
                      aria-label={`Step ${step.index + 1} description`}
                    />
                    <Badge
                      variant="outline"
                      className={cn("w-fit rounded-sm text-[10px]", toolBadgeClass(step.tool))}
                    >
                      {step.tool}
                    </Badge>
                  </div>
                </m.li>
              ))}
            </AnimatePresence>
          </ol>
        </ScrollArea>

        <div className="flex flex-col gap-2">
          <p
            className="text-xs text-muted-foreground"
            title="Worst-case estimate. Actual cost is usually lower because cached prompt tokens are billed at ~25% of the list rate and many steps complete in fewer than 500 output tokens."
          >
            Estimated max cost:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatOperatorCostUsd(
                estimateOperatorRunCost(
                  prompt.length,
                  steps.length,
                  selectedModel
                )
              )}
            </span>{" "}
            ({selectedModel})
          </p>
          <div className="flex items-center gap-2">
            {runId && (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/app/workspace_operator/live/${runId}`} />}
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
                Open full view
              </Button>
            )}
            <Button
              onClick={handleApproveAndRun}
              disabled={isExecPending || steps.length === 0}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Approve &amp; Run
            </Button>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling..." : "Cancel"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderExecuting() {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        {/* Step progress */}
        <ol className="flex flex-col gap-1.5" aria-label="Execution progress">
          <AnimatePresence initial={false}>
            {steps.map((step) => (
              <m.li
                key={step.index}
                variants={fadeRise}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="flex items-center gap-2 text-sm"
              >
                {stepStatusIcon(step.status)}
                <span
                  className={cn(
                    "truncate",
                    step.status === "completed" && "text-muted-foreground line-through"
                  )}
                >
                  {step.description}
                </span>
              </m.li>
            ))}
          </AnimatePresence>
        </ol>

        <Separator />

        {/* V3 activity panel — rich tool-call cards + live token counter +
            inline approval queue + mid-run steer input. Subscribes to the
            rich `event` broadcast emitted by the Python StreamingOperatorHooks.
            The legacy `progressEvents` stream still drives the status-chip
            animations above but its raw log is superseded by this panel. */}
        <div className="flex-1 -mx-4 min-h-0">
          <OperatorActivityPanel
            runId={runId}
            runIsActive={isActivePhase}
          />
        </div>
        <div ref={eventsEndRef} />

        <div className="flex items-center gap-2 self-start">
          {runId && (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/app/workspace_operator/live/${runId}`} />}
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
              Open full view
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling..." : "Cancel run"}
          </Button>
        </div>
      </div>
    );
  }

  function renderCompleted() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            Operator completed successfully
          </p>
          {result && (
            <p className="text-xs text-muted-foreground">
              {result.notes_created.length} note
              {result.notes_created.length !== 1 ? "s" : ""} drafted
              {" / "}
              {result.tool_calls} tool call
              {result.tool_calls !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {branchId && (
            <Button render={<Link href={`/app/branches/${branchId}`} />}>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              Review Branch
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Run Again
          </Button>
        </div>
      </div>
    );
  }

  function renderFailed() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <XCircle className="h-10 w-10 text-destructive" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            Operator run failed
          </p>
          {error && (
            <p className="text-xs text-destructive/80">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {runId && (
            <Button onClick={handleRetry} disabled={retrying}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {retrying ? "Retrying..." : "Retry"}
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            Start over
          </Button>
        </div>
      </div>
    );
  }

  function renderCancelled() {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <XCircle className="h-10 w-10 text-amber-500" />
        <p className="text-sm font-medium text-foreground">Run cancelled</p>
        <Button variant="outline" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Start over
        </Button>
      </div>
    );
  }

  // -- body selector ---------------------------------------------------------

  function renderBody() {
    switch (phase) {
      case "idle":
        return renderIdle();
      case "planning":
        return renderPlanning();
      case "awaiting_approval":
        return renderAwaitingApproval();
      case "executing":
        return renderExecuting();
      case "completed":
        return renderCompleted();
      case "failed":
        return renderFailed();
      case "cancelled":
        return renderCancelled();
      case "quota_exceeded":
        return renderQuotaExceeded();
      default:
        return renderIdle();
    }
  }

  // -- main render -----------------------------------------------------------

  function handleSelectSession(session: OperatorSession) {
    setActiveSessionId(session.id);
    reset();
  }

  function handleNewSession(session: OperatorSession) {
    setActiveSessionId(session.id);
    reset();
  }

  return (
    <>
      {mode === "page" ? (
        <div className="flex h-full flex-col">
          {/* ── Header (page mode) ──────────────────────────────────────── */}
          <div className="flex flex-row items-center gap-2 px-4 py-3 border-b border-border">
            <button
              type="button"
              onClick={() => setShowSessionsSidebar((v) => !v)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={showSessionsSidebar ? "Hide sessions" : "Show sessions"}
              title={showSessionsSidebar ? "Hide sessions" : "Show sessions"}
            >
              {showSessionsSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </button>
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-iris" aria-hidden="true" />
              AI
            </h1>
          </div>

          {/* ── Two-column layout ─────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden">
            {showSessionsSidebar && (
              <div className="w-[180px] shrink-0 overflow-hidden">
                <OperatorSessionsSidebar
                  activeSessionId={activeSessionId}
                  onSelectSession={handleSelectSession}
                  onNewSession={handleNewSession}
                />
              </div>
            )}
            <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
              {renderBody()}
            </div>
          </div>
        </div>
      ) : (
        <Sheet open={open} onOpenChange={(o) => onOpenChange(o)}>
          <SheetContent
            side="right"
            className="flex w-full flex-col p-0 sm:max-w-[680px]"
            aria-describedby="operator-panel-desc"
          >
            {/* ── Header ────────────────────────────────────────────────────── */}
            <SheetHeader className="flex-row items-center gap-2 px-4 py-3 border-b border-border">
              <button
                type="button"
                onClick={() => setShowSessionsSidebar((v) => !v)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showSessionsSidebar ? "Hide sessions" : "Show sessions"}
                title={showSessionsSidebar ? "Hide sessions" : "Show sessions"}
              >
                {showSessionsSidebar ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeft className="h-4 w-4" />
                )}
              </button>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-iris" aria-hidden="true" />
                AI
              </SheetTitle>
              <SheetDescription id="operator-panel-desc" className="sr-only">
                Your AI for research, writing, and organizing your notes.
              </SheetDescription>
            </SheetHeader>

            {/* ── Two-column layout ─────────────────────────────────────────── */}
            <div className="flex flex-1 overflow-hidden">
              {showSessionsSidebar && (
                <div className="w-[180px] shrink-0 overflow-hidden">
                  <OperatorSessionsSidebar
                    activeSessionId={activeSessionId}
                    onSelectSession={handleSelectSession}
                    onNewSession={handleNewSession}
                  />
                </div>
              )}
              <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
                {renderBody()}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      <Dialog
        open={varsDialog !== null}
        onOpenChange={(next) => {
          if (!next) setVarsDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fill in prompt variables</DialogTitle>
            <DialogDescription>
              This saved prompt has {varsDialog?.variables.length ?? 0}{" "}
              placeholder{(varsDialog?.variables.length ?? 0) === 1 ? "" : "s"}.
              Fill them in to customise the prompt.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {varsDialog?.variables.map((name) => (
              <div key={name} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`operator-var-${name}`}
                  className="text-xs font-medium text-muted-foreground"
                >
                  {`{{${name}}}`}
                </label>
                <Input
                  id={`operator-var-${name}`}
                  value={varsDialog.values[name] ?? ""}
                  onChange={(e) =>
                    setVarsDialog((prev) =>
                      prev
                        ? {
                            ...prev,
                            values: { ...prev.values, [name]: e.target.value },
                          }
                        : prev
                    )
                  }
                  placeholder={`Value for ${name}`}
                  autoFocus={name === varsDialog.variables[0]}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVarsDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleApplyVariables}>Use prompt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Save this prompt for one-click reuse later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="operator-save-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Name
            </label>
            <Input
              id="operator-save-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value.slice(0, 80))}
              placeholder="e.g. Weekly competitive brief"
              maxLength={80}
            />
            {saveError && (
              <p className="text-xs text-destructive">{saveError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={!saveName.trim() || !prompt.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-run prompt decorators (citations, future per-run flags)
// ---------------------------------------------------------------------------

const REQUIRE_CITATIONS_DIRECTIVE =
  "CITATIONS REQUIRED: For every factual claim in your output, attach an inline citation in the form [[note-id]] for workspace notes, or a full URL for web sources. Do not introduce unsourced claims. If you cannot find a citation for a claim, either drop the claim or mark it explicitly as \"(no citation)\".";

export function decoratePrompt(
  prompt: string,
  flags: { requireCitations?: boolean }
): string {
  if (!flags.requireCitations) return prompt;
  return `${REQUIRE_CITATIONS_DIRECTIVE}\n\n${prompt}`;
}

// ---------------------------------------------------------------------------
// Prompt variable substitution ({{name}} placeholders in saved prompts)
// ---------------------------------------------------------------------------

const PROMPT_VAR_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Return unique variable names (preserving first-appearance order). */
export function extractPromptVariables(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of template.matchAll(PROMPT_VAR_PATTERN)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Replace every `{{name}}` occurrence with the matching value. Unknown
 * placeholders are left untouched so the user can spot un-filled slots.
 */
export function applyPromptVariables(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(PROMPT_VAR_PATTERN, (match, name) => {
    const value = values[name];
    return typeof value === "string" && value.length > 0 ? value : match;
  });
}

// ---------------------------------------------------------------------------
// Prompt history (ring buffer, per-workspace, localStorage-backed)
// ---------------------------------------------------------------------------

/** Max prompts retained in the per-workspace history ring buffer. */
export const PROMPT_HISTORY_MAX = 10;

/** localStorage key prefix; full key is `${prefix}${workspaceOrBoxId}`. */
export const PROMPT_HISTORY_KEY_PREFIX = "operator-prompt-history:";

/**
 * Push a newly-submitted prompt onto the most-recent-first history array.
 *
 *   - Trims whitespace; rejects empty strings (returns the prev array).
 *   - Dedupes adjacent duplicates (submitting the same prompt twice in a
 *     row leaves the history unchanged, so Up-arrow cycling stays clean).
 *   - Caps the result at PROMPT_HISTORY_MAX (oldest entries drop off).
 *
 * Pure — safe to import in tests and call without a DOM.
 */
export function pushPromptHistory(
  prev: string[],
  raw: string,
  max: number = PROMPT_HISTORY_MAX
): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return prev;
  if (prev.length > 0 && prev[0] === trimmed) return prev;
  const next = [trimmed, ...prev.filter((p) => p !== trimmed)];
  if (next.length > max) next.length = max;
  return next;
}

/**
 * Load prompt history from localStorage. Returns `[]` on any parse or
 * shape error — history is advisory, not load-bearing.
 */
export function loadPromptHistory(
  storage: Pick<Storage, "getItem">,
  key: string
): string[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/**
 * Write the history array to localStorage. Swallows quota errors —
 * a full localStorage should not break the panel.
 */
export function savePromptHistory(
  storage: Pick<Storage, "setItem">,
  key: string,
  history: string[]
): void {
  try {
    storage.setItem(key, JSON.stringify(history));
  } catch {
    // Best-effort; swallow quota / permission errors.
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Narrow a raw action error to the structured quota-exceeded shape.
 * Actions can surface either a plain string or a structured object
 * (see `ActionErrorQuotaExceeded`); anything shaped like the latter
 * routes the UI into the quota_exceeded phase.
 */
function isQuotaError(
  err: unknown
): err is ActionErrorQuotaExceeded {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "quota_exceeded"
  );
}

/**
 * Coerce an `ActionResult` error (string | structured) into a flat string
 * suitable for `setError`. Quota errors carry a `.message`; plain string
 * errors pass through verbatim.
 */
export function actionErrorToString(
  err: string | ActionErrorQuotaExceeded | undefined | null,
  fallback: string
): string {
  if (err == null) return fallback;
  if (typeof err === "string") return err;
  return err.message ?? fallback;
}

function formatResetDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatEventDetail(evt: OperatorProgressEvent): string {
  switch (evt.type) {
    case "plan_ready":
      return "Plan ready";
    case "step_start":
      return `Starting step ${(evt.step_index ?? 0) + 1}${evt.detail ? `: ${evt.detail}` : ""}`;
    case "step_complete":
      return `Completed step ${(evt.step_index ?? 0) + 1}${evt.detail ? `: ${evt.detail}` : ""}`;
    case "tool_call":
      return `Tool call${evt.detail ? `: ${evt.detail}` : ""}`;
    case "note_drafted":
      return `Note drafted${evt.detail ? `: ${evt.detail}` : ""}`;
    case "completed":
      return "Run completed";
    case "failed":
      return `Failed${evt.detail ? `: ${evt.detail}` : ""}`;
    default:
      return evt.detail ?? evt.type;
  }
}
