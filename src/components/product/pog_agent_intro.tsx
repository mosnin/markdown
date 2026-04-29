"use client";

import { FileText, Link, Search, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { OPEN_OPERATOR_EVENT } from "@/components/product/operator/operator_panel_trigger";

/**
 * Intro card that explains what the AI is and how to use it, shown
 * on the empty AI run history page. Includes example prompt cards
 * that open the run panel pre-populated so new users can get started
 * with one click.
 */

const EXAMPLE_PROMPTS = [
  {
    icon: Search,
    label: "Research a topic and draft a summary note",
    prompt: "Research a topic and draft a summary note",
  },
  {
    icon: FileText,
    label: "Summarize my recent notes into a digest",
    prompt: "Summarize my recent notes into a digest",
  },
  {
    icon: Link,
    label: "Find connections I've missed between my notes",
    prompt: "Find connections I've missed between my notes",
  },
];

function openOperator(prompt?: string) {
  if (prompt) {
    // Stash the prompt so OperatorPanel can pick it up when it mounts.
    try {
      window.sessionStorage.setItem("poggle:pending-prompt", prompt);
    } catch {
      // Ignore — sessionStorage can be disabled in private modes.
    }
  }
  window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT));
}

export function PogAgentIntro() {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      {/* Icon */}
      <div className="mb-4 flex justify-center">
        <div className="rounded-xl bg-primary/10 p-3">
          <Sparkles className="h-10 w-10 text-primary" aria-hidden="true" />
        </div>
      </div>

      {/* Heading */}
      <h2 className="text-xl font-semibold text-foreground">
        Your AI knows your notes.
      </h2>

      {/* Subtext */}
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Ask it anything. Tell it to research, write, or organize. Every change
        it makes is reversible — it works on a safe copy first.
      </p>

      {/* Example prompt cards */}
      <div className="mt-6 flex flex-col gap-2">
        {EXAMPLE_PROMPTS.map(({ icon: Icon, label, prompt }) => (
          <button
            key={prompt}
            type="button"
            onClick={() => openOperator(prompt)}
            className={cn(
              "flex items-center gap-3 rounded-xl border border-border p-4 text-left",
              "cursor-pointer transition-colors hover:bg-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-foreground">{label}</span>
          </button>
        ))}
      </div>

      {/* Helper text */}
      <p className="mt-4 text-xs text-muted-foreground/60">
        Or type anything in the input below. Use{" "}
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>{" "}
        from anywhere.
      </p>
    </div>
  );
}
