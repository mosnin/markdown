"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { startConversationTurnAction } from "@/app/app/conversation/actions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Must stay in sync with the existing operator panel constant. See
// `src/components/product/operator_panel.tsx` / steer input: the server
// rejects prompts longer than this.
const MAX_PROMPT_LENGTH = 4000;
const WARN_THRESHOLD = 3800;

// Approximate pixel height of a single textarea row; used to cap the
// auto-grow at 6 rows. The textarea primitive uses `field-sizing-content`
// already, but we additionally clamp via inline height so truly long
// pasted content doesn't blow out the composer.
const ROW_PX = 24;
const MAX_ROWS = 6;
const MAX_TEXTAREA_HEIGHT_PX = ROW_PX * MAX_ROWS;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConversationComposerProps {
  workspaceId: string;
  /** Default box id to draft into. When null, the action picks the
   *  workspace's first box. When the workspace has zero boxes, the action
   *  returns an error and the composer should surface it inline. */
  defaultBoxId: string | null;
  /** Has the workspace been used to start at least one run? Used only to
   *  pick a placeholder copy ("Ask Pog…" vs "Ask anything to get
   *  started"). Not load-bearing. */
  hasHistory: boolean;
  /** Called immediately after the action returns ok:true with the new
   *  runId. The parent updates its `activeRunId` so the transcript
   *  starts streaming events. */
  onRunStarted: (runId: string) => void;
  /** When false, renders a disabled "AI not configured" banner instead of
   *  the normal composer. Defaults to true. */
  operatorEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Bottom-pinned input bar for the conversation page. User types a prompt,
 * hits Enter, and we dispatch `startConversationTurnAction` to kick off a
 * new Operator run. The resulting `runId` is handed back via `onRunStarted`
 * so the parent can subscribe the transcript to its events.
 *
 * Ruthlessly simple on purpose: no file uploads, no model picker, no stop
 * button. The action is fire-and-forget — cancel lives in the live view.
 */
export function ConversationComposer({
  workspaceId: _workspaceId,
  defaultBoxId,
  hasHistory,
  onRunStarted,
  operatorEnabled = true,
}: ConversationComposerProps) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: resize the textarea to fit content up to MAX_ROWS, then let
  // it scroll. We reset to `auto` first so shrinking works when the user
  // deletes content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX);
    el.style.height = `${next}px`;
  }, [value]);

  const length = value.length;
  const trimmedLength = value.trim().length;
  const overLimit = length > MAX_PROMPT_LENGTH;
  const canSend = !pending && trimmedLength > 0 && !overLimit;

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (pending) return;

    setPending(true);
    setError(null);

    // Optimistic clear — the parent will show our prompt in the transcript
    // immediately via its own state. Clearing here keeps the composer
    // ready for the next message without flicker.
    const sent = trimmed;
    setValue("");

    try {
      const result = await startConversationTurnAction({
        prompt: sent,
        boxId: defaultBoxId,
      });
      if (!result.ok) {
        setError(result.error);
        // Restore the prompt so the user doesn't lose their text.
        setValue(sent);
        return;
      }
      onRunStarted(result.data.runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setValue(sent);
    } finally {
      setPending(false);
    }
  }, [value, pending, defaultBoxId, onRunStarted]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Esc blurs but doesn't clear — keeps the draft safe.
    if (e.key === "Escape") {
      e.currentTarget.blur();
      return;
    }
    if (e.key === "Enter") {
      // Shift+Enter: let the default newline behavior happen.
      if (e.shiftKey) return;
      // Enter or Cmd/Ctrl+Enter: submit.
      e.preventDefault();
      void handleSubmit();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    // Truncate at MAX_PROMPT_LENGTH so the user can't paste past the cap
    // and then be surprised by a server-side rejection.
    const next = e.target.value.slice(0, MAX_PROMPT_LENGTH);
    setValue(next);
    if (error) setError(null);
  }

  const placeholder = hasHistory
    ? "Ask AI…"
    : "Ask anything — Atlas AI will plan, search, and draft.";

  if (!operatorEnabled) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>AI features are not configured for this workspace. Set <code className="rounded bg-muted px-1 font-mono">WORKSPACE_OPERATOR_ENABLED=true</code> to enable Atlas AI.</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      {error && (
        <div
          role="alert"
          className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={pending}
            rows={1}
            placeholder={placeholder}
            aria-label="Message composer"
            className={cn(
              "min-h-10 resize-none py-2 text-sm",
              pending && "opacity-80"
            )}
            style={{ maxHeight: `${MAX_TEXTAREA_HEIGHT_PX}px` }}
          />
        </div>
        <Button
          type="button"
          variant="default"
          size="icon"
          onClick={() => void handleSubmit()}
          disabled={!canSend}
          aria-label="Send message"
        >
          {pending ? (
            <Spinner size={16} invert aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 px-0.5 text-[11px]">
        <span className="text-muted-foreground/70">
          Enter to send · Shift+Enter for newline
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            length > WARN_THRESHOLD
              ? "text-destructive"
              : "text-muted-foreground/70"
          )}
          aria-live="polite"
        >
          {length}/{MAX_PROMPT_LENGTH} chars
        </span>
      </div>
    </div>
  );
}
