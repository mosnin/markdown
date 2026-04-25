"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { OPEN_OPERATOR_EVENT } from "@/components/product/operator/operator_panel_trigger";
import { startConversationTurnAction } from "@/app/app/conversation/actions";

interface AskPogSelectionPopoverProps {
  /** Ref to the textarea we're watching for text selections. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Context phrase prepended to the selected text when opening Pog. */
  contextLabel: string;
  /** When provided, enables inline quick-action buttons that call startConversationTurnAction directly. */
  workspaceId?: string;
  /** The box ID to scope inline actions to. */
  boxId?: string | null;
}

const MAX_SELECTION_LENGTH = 2000;

export function AskPogSelectionPopover({
  textareaRef,
  contextLabel,
  workspaceId,
  boxId,
}: AskPogSelectionPopoverProps) {
  const [state, setState] = useState<{
    top: number;
    left: number;
    text: string;
  } | null>(null);
  const [inlineRunPending, setInlineRunPending] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const recompute = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setState(null);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null || start === end) {
      setState(null);
      return;
    }
    const text = el.value.slice(start, end).trim();
    if (!text) {
      setState(null);
      return;
    }
    // Position the popover at the top-right of the textarea. Anchoring to
    // the exact caret would require a mirror div hack; top-right is a
    // predictable, good-enough target that never blocks the selection.
    const rect = el.getBoundingClientRect();
    setState({
      top: rect.top + 8,
      left: Math.max(8, rect.right - 110),
      text: text.slice(0, MAX_SELECTION_LENGTH),
    });
  }, [textareaRef]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = () => recompute();
    el.addEventListener("mouseup", handler);
    el.addEventListener("keyup", handler);
    el.addEventListener("select", handler);
    document.addEventListener("selectionchange", handler);
    return () => {
      el.removeEventListener("mouseup", handler);
      el.removeEventListener("keyup", handler);
      el.removeEventListener("select", handler);
      document.removeEventListener("selectionchange", handler);
    };
  }, [recompute, textareaRef]);

  useEffect(() => {
    if (!state) return;
    function handleDocMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        containerRef.current.contains(e.target)
      ) {
        return;
      }
      // Let the browser update selection first, then re-check.
      setTimeout(recompute, 0);
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [state, recompute]);

  if (!state) return null;

  async function dispatchInlineAction(promptText: string) {
    if (!workspaceId || inlineRunPending) return;
    setInlineRunPending(true);
    try {
      await startConversationTurnAction({
        prompt: promptText,
        boxId: boxId ?? null,
      });
    } finally {
      setInlineRunPending(false);
      setState(null);
    }
  }

  function handleClick() {
    const prompt = `${contextLabel}\n\nSelected text:\n"""\n${state!.text}\n"""\n\nHelp me with this selection.`;
    try {
      window.sessionStorage.setItem("poggle:pending-prompt", prompt);
    } catch {
      // sessionStorage blocked (private mode) — panel still opens.
    }
    window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT));
    setState(null);
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "fixed", top: state.top, left: state.left, zIndex: 50 }}
      className="rounded-md border border-input bg-background p-1.5 shadow-md"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleClick}
        className="inline-flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-fast hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sparkles className="h-3.5 w-3.5 text-foreground/70" aria-hidden="true" />
        Ask Pog
      </button>
      {workspaceId && (
        <div className="flex flex-col gap-0.5 border-t border-border pt-1 mt-1">
          {[
            { label: "Expand", prompt: `Expand on this:\n\n"${state.text}"` },
            { label: "Simplify", prompt: `Simplify this for a general audience:\n\n"${state.text}"` },
            { label: "Find related", prompt: `Find notes in this box related to:\n\n"${state.text}"` },
          ].map(({ label, prompt }) => (
            <button
              key={label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void dispatchInlineAction(prompt)}
              disabled={inlineRunPending}
              className="rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
