"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

export interface SteerInputProps {
  runId: string;
  /** Whether the run is in a state that accepts steering. When false, input is disabled. */
  enabled: boolean;
  /** Optional: called after a successful send so parent can give visual feedback */
  onSent?: (content: string) => void;
}

// Must stay in sync with the backend limit — see
// /api/agent/operator/steer.
const MAX_CHARS = 4000;
const WARN_THRESHOLD = 3800;
const SENT_FLASH_MS = 1000;

interface SteerResponse {
  data?: unknown;
  error?: { message?: string };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact textarea for sending a "steering" message to a running agent.
 *
 * Enter submits, Shift+Enter inserts a newline. Disabled when the parent
 * says the run isn't in a steerable state — in that case the whole control
 * is grayed out and a tooltip explains why.
 */
export function SteerInput({ runId, enabled, onSent }: SteerInputProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const trimmed = content.trim();
  const length = content.length;
  const overLimit = length > MAX_CHARS;
  const canSend = enabled && !submitting && trimmed.length > 0 && !overLimit;

  const send = useCallback(async () => {
    if (!canSend) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/agent/operator/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId, content: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as SteerResponse | null;
        throw new Error(
          body?.error?.message ?? `Steer failed (${res.status})`
        );
      }
      setContent("");
      onSent?.(trimmed);
      setJustSent(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        setJustSent(false);
        flashTimer.current = null;
      }, SENT_FLASH_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [canSend, runId, trimmed, onSent]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    // Enforce the client-side cap by truncating — matches backend validation
    // so the user can't paste a 10kB blob and get a mysterious 400.
    const next = e.target.value.slice(0, MAX_CHARS);
    setContent(next);
    if (error) setError(null);
  }

  const disabled = !enabled || submitting;

  const input = (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        !enabled && "opacity-60"
      )}
    >
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            placeholder="Send a message to the running agent..."
            aria-label="Steering message"
            className={cn(
              // Auto-grow up to 4 rows (~6rem) via field-sizing-content
              // already baked into the Textarea primitive. Cap max-height.
              "min-h-9 max-h-24 resize-none py-2 text-sm"
            )}
          />
        </div>
        <Button
          type="button"
          variant="default"
          size="icon"
          onClick={() => void send()}
          disabled={!canSend}
          aria-label="Send steering message"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : justSent ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 px-0.5 text-[11px]">
        <div className="min-w-0 flex-1">
          {error ? (
            <span
              role="alert"
              className="flex items-center gap-1 text-destructive"
            >
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{error}</span>
            </span>
          ) : justSent ? (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Check className="h-3 w-3" aria-hidden="true" />
              Sent
            </span>
          ) : (
            <span className="text-muted-foreground/70">
              Enter to send · Shift+Enter for newline
            </span>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            length > WARN_THRESHOLD
              ? "text-destructive"
              : "text-muted-foreground/70"
          )}
          aria-live="polite"
        >
          {length}/{MAX_CHARS}
        </span>
      </div>
    </div>
  );

  if (enabled) return input;

  // Disabled state wraps the control in a tooltip explaining why. Base UI's
  // TooltipTrigger uses a `render` prop (JSX element) to forward its props
  // onto our custom wrapper — the underlying Textarea/Button are disabled,
  // so we need a hoverable parent to catch the tooltip activation.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="w-full cursor-not-allowed">{input}</div>
          }
        />
        <TooltipContent>
          Steering only available while the agent is running
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
