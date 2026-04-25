"use client";

/**
 * NoteAiCopilotTab
 *
 * Client component that renders the "AI" tab in the Note Context Panel.
 *
 * Contains:
 *   1. "Improve this Note" button — one-click operator pre-fill
 *   2. Free-text input — "Ask AI about this note…" → opens operator with context
 *   3. AI Action Timeline — filtered version history entries
 *   4. Pending proposals section — links to approve/reject
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OPEN_OPERATOR_EVENT } from "@/components/product/operator/operator_panel_trigger";
import { NoteAiTimeline, type AiTimelineEntry } from "@/components/product/notes/note_ai_timeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingProposalRef {
  id: string;
  type: string;
  connectionName: string | null;
  createdAt: string;
}

interface NoteAiCopilotTabProps {
  noteId: string;
  noteTitle: string;
  aiTimelineEntries: AiTimelineEntry[];
  pendingProposals: PendingProposalRef[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stashAndOpenOperator(prompt: string): void {
  try {
    window.sessionStorage.setItem("poggle:pending-prompt", prompt);
  } catch {
    // sessionStorage blocked — panel still opens
  }
  window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT));
}

// ---------------------------------------------------------------------------
// Section wrapper (matches the InfoSection style in page.tsx)
// ---------------------------------------------------------------------------

function Section({
  children,
  border = true,
}: {
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div className={cn("px-4 py-3", border && "border-b border-border")}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// NoteAiCopilotTab
// ---------------------------------------------------------------------------

export function NoteAiCopilotTab({
  noteId,
  noteTitle,
  aiTimelineEntries,
  pendingProposals,
}: NoteAiCopilotTabProps) {
  const [query, setQuery] = useState("");

  // ── "Improve this Note" prompt ──────────────────────────────────────────

  function handleImprove() {
    const prompt = `Analyze this note titled "${noteTitle}". Check for: clarity (is the writing clear?), completeness (are there obvious gaps?), and connections (are there related notes that should be linked?). Propose 2-3 concrete improvements as a bulleted list. Do not rewrite the entire note.`;
    stashAndOpenOperator(prompt);
  }

  // ── "Ask AI" free-text submit ───────────────────────────────────────────

  function handleAskSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const prompt = `Regarding the note titled "${noteTitle}":\n\n${trimmed}`;
    stashAndOpenOperator(prompt);
    setQuery("");
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      {/* ── 1. Improve this Note ───────────────────────────────────────── */}
      <Section>
        <button
          type="button"
          onClick={handleImprove}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-xs font-medium transition-colors",
            "bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <Sparkles className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
          Improve this note
        </button>
        <p className="mt-1.5 text-[10px] text-muted-foreground/60 text-center">
          Checks clarity, completeness &amp; connections
        </p>
      </Section>

      {/* ── 2. Ask AI about this note ──────────────────────────────────── */}
      <Section>
        <SectionLabel>Ask AI</SectionLabel>
        <form onSubmit={handleAskSubmit} className="flex flex-col gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask AI about this note…"
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs",
              "placeholder:text-muted-foreground/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors self-end",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:pointer-events-none disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <Send className="h-3 w-3" aria-hidden="true" />
            Send
          </button>
        </form>
      </Section>

      {/* ── 3. AI Action Timeline ──────────────────────────────────────── */}
      <Section>
        <SectionLabel>AI history</SectionLabel>
        <NoteAiTimeline entries={aiTimelineEntries} />
      </Section>

      {/* ── 4. Pending proposals ───────────────────────────────────────── */}
      {pendingProposals.length > 0 && (
        <Section border={false}>
          <SectionLabel>
            Pending proposals ({pendingProposals.length})
          </SectionLabel>
          <div className="flex flex-col gap-1.5">
            {pendingProposals.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-foreground truncate capitalize">
                    {p.type.replace(/_/g, " ")}
                  </p>
                  {p.connectionName && (
                    <p className="text-[10px] text-muted-foreground/70 truncate">
                      {p.connectionName}
                    </p>
                  )}
                </div>
                <Link
                  href={`/app/proposals`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Review proposal"
                >
                  Review
                  <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
                </Link>
              </div>
            ))}
            <Link
              href="/app/proposals"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              View all proposals
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </Section>
      )}

      {/* When no pending proposals, show a muted link */}
      {pendingProposals.length === 0 && (
        <Section border={false}>
          <SectionLabel>Pending proposals</SectionLabel>
          <p className="text-[11px] text-muted-foreground/60">
            No pending proposals for this note.{" "}
            <Link
              href="/app/proposals"
              className="text-foreground/50 hover:text-foreground underline underline-offset-2 transition-colors"
            >
              View all
            </Link>
          </p>
        </Section>
      )}

      {/* Suppress unused param warning — noteId reserved for future use */}
      {/* (e.g. per-note proposal filtering via a server action) */}
      <span data-note-id={noteId} className="sr-only" aria-hidden="true" />
    </ScrollArea>
  );
}
