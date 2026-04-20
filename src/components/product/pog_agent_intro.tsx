"use client";

import {
  FileSearch,
  FileText,
  Globe,
  Link2,
  PenLine,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { OPEN_OPERATOR_EVENT } from "@/components/product/operator_panel_trigger";

/**
 * Intro card that explains what Pog Agent is and how to use it, shown
 * at the top of the Pog Agent history page. Includes example prompt
 * chips that open the run panel pre-populated so new users can get a
 * feel for the tool with one click.
 */

const TOOLS = [
  { icon: FileSearch, label: "Search notes", desc: "Hybrid keyword + semantic search across your workspace." },
  { icon: FileText, label: "Read notes", desc: "Fetches full note contents, including linked references." },
  { icon: Globe, label: "Fetch web pages", desc: "Grabs public URLs so Pog can cite sources outside your workspace." },
  { icon: PenLine, label: "Draft & edit notes", desc: "Writes new notes or edits existing ones — always on a branch." },
  { icon: Link2, label: "Link notes", desc: "Adds bidirectional links so related notes stay connected." },
];

const EXAMPLE_PROMPTS = [
  "Draft a weekly digest from my notes tagged #thisweek.",
  "Summarize my recent meeting notes into action items.",
  "Research competitor X and draft a brief with sources.",
  "Find orphan notes and suggest connections between them.",
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
    <div
      className={cn(
        "mb-6 rounded-xl border border-border/60 bg-gradient-to-br from-background to-muted/30",
        "p-5 shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Pog is your workspace research agent
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Give Pog a prompt and it will search your notes, fetch sources, and
            draft or edit notes on your behalf — all with citations. Every
            change lands on a <span className="font-medium text-foreground">draft branch</span> so you
            review before anything touches main.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map(({ icon: Icon, label, desc }) => (
          <div
            key={label}
            className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-background/60 p-3"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-lg border border-border/40 bg-background/60 p-3">
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70"
          aria-hidden="true"
        />
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Safe by default.</span>{" "}
          Pog only writes to a draft branch. Review the diff, then promote or
          discard. Nothing touches your main workspace without your approval.
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Try an example
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => openOperator(prompt)}
              className={cn(
                "rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground",
                "transition-fast hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {prompt}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Or click{" "}
          <span className="font-medium text-foreground">New run</span> above to
          write your own prompt. You can also launch Pog from anywhere with{" "}
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>{" "}
          → Run Pog Agent.
        </p>
      </div>
    </div>
  );
}
