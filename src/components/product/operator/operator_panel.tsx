"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Bot, PanelLeft, PanelLeftClose } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/product/page_header";
import { OperatorSessionsSidebar } from "@/components/product/operator/operator_sessions_sidebar";
import { OperatorComposer } from "@/components/product/operator/operator_composer";
import {
  OperatorTranscript,
  type QuotaExceededState,
} from "@/components/product/operator/operator_transcript";
import { OperatorPlanRail } from "@/components/product/operator/operator_plan_rail";
import { OperatorSteerBar } from "@/components/product/operator/operator_steer_bar";

import { useOperatorProgress } from "@/lib/hooks/use_operator_run";
import type { OperatorSession } from "@/server/services/operator_sessions_service";
import {
  approveAndExecuteAction,
  cancelRunAction,
  listSavedPromptsAction,
  requestOperatorPlanAction,
  retryRunAction,
  runWorkspaceOperatorAction,
  saveOperatorPromptAction,
  type ActionErrorQuotaExceeded,
} from "@/app/app/workspace_operator/actions";
import { loadOperatorQuotaAction } from "@/app/app/workspace_operator/quota_actions";
import {
  DEFAULT_OPERATOR_MODEL,
  OPERATOR_MODELS,
  type OperatorModel,
  type OperatorPlanStep,
  type OperatorRunPhase,
  type SavedOperatorPrompt,
} from "@/app/app/workspace_operator/types";
import type { WorkspacePlan } from "@/server/services/subscription_service";

// ---------------------------------------------------------------------------
// Operator panel — orchestrator
//
// Owns all run-state, server-action calls, and the live progress
// subscription. Delegates rendering to four focused sub-components:
//
//   - OperatorComposer       — input + chip rail + send (idle phase)
//   - OperatorTranscript     — message scrollback + plan + activity panel
//   - OperatorPlanRail       — right-side plan/diff rail (mode="page" only)
//   - OperatorSteerBar       — cancel / approve / retry controls
//
// Layout:
//   - mode="page" (mounted at /app)        →  PageHeader + sessions sidebar
//                                             + transcript + composer + plan rail
//   - mode="sheet" (mounted by trigger)    →  right-side Sheet drawer with
//                                             sessions sidebar + transcript
//                                             + composer (no plan rail; the
//                                             sheet is already narrow)
//
// Behaviors preserved verbatim:
//   - Streaming events via useOperatorProgress + per-event step updates
//   - Approvals: requestOperatorPlanAction → approveAndExecuteAction
//   - Branch awareness: branchId returned from server actions
//   - Autosave drafts via per-workspace localStorage prompt history
//   - Keyboard: Cmd/Ctrl+K focus, Esc cancel, ↑/↓ recall, Cmd/Ctrl+↵ submit
//   - Quota gating (preload + structured `quota_exceeded` action error)
// ---------------------------------------------------------------------------

interface OperatorPanelProps {
  /** "sheet" (default) slides in as a right-side drawer. "page" renders inline at full height. */
  mode?: "sheet" | "page";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultBoxId?: string;
}

const MAX_PROMPT_LENGTH = 4000;
const LIVE_LOG_TAIL = 8;

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
  // -- core state ------------------------------------------------------------
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

  // Wave 2 — model picker, saved prompts, dialogs, in-flight cancellation.
  const [selectedModel, setSelectedModel] = useState<OperatorModel>(
    DEFAULT_OPERATOR_MODEL
  );
  const [savedPrompts, setSavedPrompts] = useState<SavedOperatorPrompt[]>([]);
  const [savedPromptsOpen, setSavedPromptsOpen] = useState(false);
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

  // Prompt-history recall state. -1 means "not recalling".
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // -- live progress subscription -------------------------------------------
  const isActivePhase =
    phase === "planning" ||
    phase === "awaiting_approval" ||
    phase === "executing";
  const progressEvents = useOperatorProgress(isActivePhase ? runId : null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const liveTail = useMemo(
    () => progressEvents.slice(-LIVE_LOG_TAIL),
    [progressEvents]
  );

  // -- quota preload ---------------------------------------------------------
  // Mode "page" is always-on; mode "sheet" only fetches once the sheet opens.
  const quotaActive = mode === "page" || open;
  useEffect(() => {
    if (!quotaActive) return;
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
  }, [quotaActive, phase]);

  useEffect(() => {
    if (!quotaActive) return;
    let cancelled = false;
    listSavedPromptsAction().then((res) => {
      if (cancelled || !res.ok) return;
      setSavedPrompts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [quotaActive]);

  // Pick up a pending prompt stashed by the "Try an example" chips.
  useEffect(() => {
    if (!quotaActive || typeof window === "undefined") return;
    try {
      const pending = window.sessionStorage.getItem("poggle:pending-prompt");
      if (pending) {
        setPrompt(pending.slice(0, MAX_PROMPT_LENGTH));
        window.sessionStorage.removeItem("poggle:pending-prompt");
      }
    } catch {
      // sessionStorage blocked — nothing to pick up.
    }
  }, [quotaActive]);

  // -- derived ---------------------------------------------------------------
  const boxId = defaultBoxId ?? "";

  // Per-workspace prompt-history key.
  const promptHistoryKey = boxId
    ? `${PROMPT_HISTORY_KEY_PREFIX}${boxId}`
    : null;

  useEffect(() => {
    if (!quotaActive || !promptHistoryKey || typeof window === "undefined") return;
    const loaded = loadPromptHistory(window.localStorage, promptHistoryKey);
    setPromptHistory(loaded);
  }, [quotaActive, promptHistoryKey]);

  // Tear down progress subscription when sheet closes after terminal phase.
  useEffect(() => {
    if (open) return;
    if (phase === "completed" || phase === "failed" || phase === "cancelled") {
      setRunId(null);
    }
  }, [open, phase]);

  // Pro/Business may opt into the bigger model. (Currently informational —
  // wired through to model changers in a follow-up.) Free is locked to mini.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _canUseLargeModel =
    quotaPreview?.tier === "pro" || quotaPreview?.tier === "business";

  // Scroll the events tail into view when new events arrive.
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressEvents.length]);

  // Update step statuses from live progress events.
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

    // Auto mode — skip plan/approve and dispatch immediately.
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
   * If we have no runId yet, fall back to a local-only reset.
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
        setTimeout(reset, 1200);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to cancel.");
        setCancelling(false);
      });
  }

  /**
   * Retry a failed run — mints a new runs row server-side via retryRunAction
   * and re-enters the planning/executing phase.
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
  const isCancellable = phase === "planning" || phase === "executing";

  const handleCancelRef = useRef(handleCancel);
  const handleGeneratePlanRef = useRef(handleGeneratePlan);
  handleCancelRef.current = handleCancel;
  handleGeneratePlanRef.current = handleGeneratePlan;

  // Cmd/Ctrl+K — focus the prompt textarea, opening the sheet if needed.
  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (mode === "sheet" && !open) onOpenChange(true);
        setTimeout(() => {
          promptTextareaRef.current?.focus();
        }, 0);
      }
    }
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [open, onOpenChange, mode]);

  // Esc while cancellable run is running.
  useEffect(() => {
    if (mode === "sheet" && !open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!isCancellable) return;
      if (cancelling) return;
      if (saveDialogOpen) return;
      e.preventDefault();
      handleCancelRef.current();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, isCancellable, cancelling, saveDialogOpen, mode]);

  /**
   * Textarea keydown — Cmd/Ctrl+Enter submit, Up/Down history recall, Esc clears.
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
    setSavedPromptsOpen(false);
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

  function handleSelectSession(session: OperatorSession) {
    setActiveSessionId(session.id);
    reset();
  }

  function handleNewSession(session: OperatorSession) {
    setActiveSessionId(session.id);
    reset();
  }

  // -- composer props --------------------------------------------------------
  const quotaDisabled = quotaPreview !== null && !quotaPreview.allowed;
  const quotaTitle = quotaDisabled
    ? `You've used all ${quotaPreview?.limit ?? "∞"} Operator runs on the ${quotaPreview!.tier} tier this month. Resets on ${formatResetDate(quotaPreview!.resetsAt)}.`
    : null;

  const composer = (
    <OperatorComposer
      prompt={prompt}
      onPromptChange={setPrompt}
      onPromptKeyDown={handlePromptKeyDown}
      onResetHistoryIndex={() => {
        if (historyIndex !== -1) setHistoryIndex(-1);
      }}
      onSend={handleGeneratePlan}
      textareaRef={promptTextareaRef}
      hasBox={Boolean(boxId)}
      isPlanPending={isPlanPending}
      isExecPending={isExecPending}
      quotaDisabled={quotaDisabled}
      quotaTitle={quotaTitle}
      defaultBoxId={defaultBoxId}
      requireCitations={requireCitations}
      onToggleCitations={() => setRequireCitations((v) => !v)}
      autoMode={autoMode}
      onToggleAutoMode={() => setAutoMode((v) => !v)}
      savedPrompts={savedPrompts}
      savedPromptsOpen={savedPromptsOpen}
      onToggleSavedPrompts={() => setSavedPromptsOpen((v) => !v)}
      onSelectSavedPrompt={handleSelectSavedPrompt}
      onOpenSaveDialog={handleOpenSaveDialog}
      quotaReached={quotaDisabled}
      shortcutHint={
        autoMode ? "↵ runs immediately" : "↵ generates a plan to review"
      }
      maxPromptLength={MAX_PROMPT_LENGTH}
    />
  );

  const transcriptFor = (variant: "sheet" | "page") => (
    <OperatorTranscript
      phase={phase}
      prompt={prompt}
      steps={steps}
      summary={summary}
      error={error}
      result={result}
      runId={runId}
      branchId={branchId}
      selectedModel={selectedModel}
      liveTail={liveTail}
      isExecPending={isExecPending}
      cancelling={cancelling}
      retrying={retrying}
      isActivePhase={isActivePhase}
      activeSessionId={activeSessionId}
      sessionHistoryRefreshKey={sessionHistoryRefreshKey}
      quotaExceeded={quotaExceeded}
      // Page mode hands action buttons to the SteerBar below so the
      // transcript stays clean. Sheet mode keeps them inline because
      // the drawer is too narrow for a separate steer-bar row.
      hideInlineActions={variant === "page"}
      onStepDescriptionChange={handleStepDescriptionChange}
      onApproveAndRun={handleApproveAndRun}
      onCancel={handleCancel}
      onRetry={handleRetry}
      onReset={reset}
      eventsEndRef={eventsEndRef}
      formatResetDate={formatResetDate}
    />
  );

  const steerBar =
    mode === "page" ? (
      <OperatorSteerBar
        phase={phase}
        runId={runId}
        isExecPending={isExecPending}
        cancelling={cancelling}
        retrying={retrying}
        hasSteps={steps.length > 0}
        onApproveAndRun={handleApproveAndRun}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onReset={reset}
      />
    ) : null;

  // -- render ---------------------------------------------------------------
  return (
    <>
      {mode === "page" ? (
        <div className="flex h-full flex-col overflow-hidden">
          <PageHeader
            title="AI"
            description="Your AI for research, writing, and organizing your notes."
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowSessionsSidebar((v) => !v)}
                aria-label={
                  showSessionsSidebar ? "Hide sessions" : "Show sessions"
                }
                title={showSessionsSidebar ? "Hide sessions" : "Show sessions"}
              >
                {showSessionsSidebar ? (
                  <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PanelLeft className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            }
          />

          <div className="flex flex-1 overflow-hidden">
            {showSessionsSidebar && (
              <div className="hidden w-[200px] shrink-0 overflow-hidden border-r border-border md:block">
                <OperatorSessionsSidebar
                  activeSessionId={activeSessionId}
                  onSelectSession={handleSelectSession}
                  onNewSession={handleNewSession}
                />
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {transcriptFor("page")}
              {steerBar}
              {phase === "idle" && composer}
            </div>

            <OperatorPlanRail
              runId={runId}
              phase={phase}
              prompt={prompt}
              steps={steps}
            />
          </div>
        </div>
      ) : (
        <Sheet open={open} onOpenChange={(o) => onOpenChange(o)}>
          <SheetContent
            side="right"
            className="flex w-full flex-col p-0 sm:max-w-[680px]"
            aria-describedby="operator-panel-desc"
          >
            <SheetHeader className="flex-row items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowSessionsSidebar((v) => !v)}
                aria-label={
                  showSessionsSidebar ? "Hide sessions" : "Show sessions"
                }
                title={showSessionsSidebar ? "Hide sessions" : "Show sessions"}
              >
                {showSessionsSidebar ? (
                  <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PanelLeft className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" aria-hidden="true" />
                AI
              </SheetTitle>
              <SheetDescription id="operator-panel-desc" className="sr-only">
                Your AI for research, writing, and organizing your notes.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 overflow-hidden">
              {showSessionsSidebar && (
                <div className="w-[180px] shrink-0 overflow-hidden border-r border-border">
                  <OperatorSessionsSidebar
                    activeSessionId={activeSessionId}
                    onSelectSession={handleSelectSession}
                    onNewSession={handleNewSession}
                  />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {transcriptFor("sheet")}
                {phase === "idle" && composer}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Saved-prompt variable substitution dialog. */}
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
              placeholder
              {(varsDialog?.variables.length ?? 0) === 1 ? "" : "s"}. Fill them
              in to customise the prompt.
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

      {/* Save-as-template dialog. */}
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
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
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
 */
function isQuotaError(err: unknown): err is ActionErrorQuotaExceeded {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "quota_exceeded"
  );
}

/**
 * Coerce an `ActionResult` error (string | structured) into a flat string.
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
