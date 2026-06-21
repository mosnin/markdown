"use client";

import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { OPEN_OPERATOR_EVENT } from "@/components/product/operator/operator_panel_trigger";

interface AskPogInlineButtonProps {
  /** Visible label on the button. Keep short (e.g. "Ask Pog about this box"). */
  label: string;
  /**
   * Prompt that gets prefilled into the Pog run panel when the button is
   * clicked. Typically includes the surrounding context (box or note name,
   * id, etc) so the user can hit "Generate Plan" immediately.
   */
  prompt: string;
  /** Optional styling override — defaults to a pill that matches note/box toolbars. */
  className?: string;
  /** Optional icon color override (e.g. white on a solid violet pill). */
  iconClassName?: string;
}

/**
 * Inline launcher for Pog Agent scoped to a piece of context (box, note,
 * folder, etc). Writes the prefill prompt to sessionStorage and fires
 * the global `OPEN_OPERATOR_EVENT` — the operator panel in the app
 * layout picks up the event, opens, and reads the stashed prompt into
 * its textarea.
 */
export function AskPogInlineButton({
  label,
  prompt,
  className,
  iconClassName,
}: AskPogInlineButtonProps) {
  function handleClick() {
    try {
      window.sessionStorage.setItem("poggle:pending-prompt", prompt);
    } catch {
      // sessionStorage blocked (private mode) — the panel will still open.
    }
    window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-fast",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Sparkles className={cn("h-3.5 w-3.5 text-foreground/70", iconClassName)} aria-hidden="true" />
      {label}
    </button>
  );
}
