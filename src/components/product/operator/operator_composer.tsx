"use client";

import { type RefObject, type KeyboardEvent } from "react";
import {
  ArrowUp,
  BookOpen,
  Layers,
  Quote,
  Save,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SavedOperatorPrompt } from "@/app/app/workspace_operator/types";

// ---------------------------------------------------------------------------
// Operator composer — the input surface for the operator panel.
//
// Owns no state of its own. Every interaction is forwarded to the parent
// (orchestrator) so streaming, autosave, and quota gating remain in one
// place. The composer focuses on:
//
//   - the textarea + slash-style chip rail (citations, auto-run, templates)
//   - the send button (brand-yellow primary, overlaid bottom-right)
//   - keyboard wiring forwarded to the parent's Cmd/Ctrl+Enter / arrow-key
//     history recall handler
//
// All visuals use semantic tokens. The send button is the one place we
// allow the brand yellow accent — it is the primary affordance of the
// page.
// ---------------------------------------------------------------------------

export interface OperatorComposerProps {
  prompt: string;
  onPromptChange: (next: string) => void;
  onPromptKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onResetHistoryIndex: () => void;
  onSend: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;

  /** Whether the workspace has a default box (gates submission). */
  hasBox: boolean;
  /** Pending transitions (planning / executing). */
  isPlanPending: boolean;
  isExecPending: boolean;
  /** Quota: when present and not allowed, disables submission. */
  quotaDisabled: boolean;
  quotaTitle?: string | null;

  /** Toggles. */
  defaultBoxId: string | undefined;
  requireCitations: boolean;
  onToggleCitations: () => void;
  autoMode: boolean;
  onToggleAutoMode: () => void;

  /** Templates dropdown. */
  savedPrompts: SavedOperatorPrompt[];
  savedPromptsOpen: boolean;
  onToggleSavedPrompts: () => void;
  onSelectSavedPrompt: (id: string) => void;

  /** Save-template dialog opener. */
  onOpenSaveDialog: () => void;

  /** Quota-reached note rendered under the textarea. */
  quotaReached?: boolean;

  /** "↵ runs immediately" / "↵ generates a plan" hint. */
  shortcutHint: string;

  /** Maximum prompt length. */
  maxPromptLength: number;
}

export function OperatorComposer({
  prompt,
  onPromptChange,
  onPromptKeyDown,
  onResetHistoryIndex,
  onSend,
  textareaRef,
  hasBox,
  isPlanPending,
  isExecPending,
  quotaDisabled,
  quotaTitle,
  defaultBoxId,
  requireCitations,
  onToggleCitations,
  autoMode,
  onToggleAutoMode,
  savedPrompts,
  savedPromptsOpen,
  onToggleSavedPrompts,
  onSelectSavedPrompt,
  onOpenSaveDialog,
  quotaReached,
  shortcutHint,
  maxPromptLength,
}: OperatorComposerProps) {
  const sendDisabled =
    !prompt.trim() ||
    !hasBox ||
    isPlanPending ||
    isExecPending ||
    quotaDisabled;

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-background p-4">
      {/* Context chip rail */}
      <div className="flex flex-wrap items-center gap-2">
        {defaultBoxId && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] text-muted-foreground">
            <Layers className="h-3 w-3" aria-hidden="true" />
            Collection
          </span>
        )}
        <ChipToggle
          active={requireCitations}
          onClick={onToggleCitations}
          icon={<Quote className="h-3 w-3" aria-hidden="true" />}
          label="Cite sources"
        />
        <ChipToggle
          active={autoMode}
          onClick={onToggleAutoMode}
          icon={<Zap className="h-3 w-3" aria-hidden="true" />}
          label="Auto run"
        />
        {savedPrompts.length > 0 && (
          <div className="relative">
            <ChipToggle
              active={savedPromptsOpen}
              onClick={onToggleSavedPrompts}
              icon={<BookOpen className="h-3 w-3" aria-hidden="true" />}
              label="Templates"
              ariaLabel="Templates"
            />
            {savedPromptsOpen && (
              <div
                className="absolute bottom-full left-0 z-10 mb-1 min-w-[200px] rounded-md border border-border bg-card shadow-lg"
                role="menu"
              >
                <div className="flex flex-col py-1">
                  {savedPrompts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectSavedPrompt(p.id)}
                      className="truncate px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent"
                      role="menuitem"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onOpenSaveDialog}
          disabled={!prompt.trim()}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Save as template"
        >
          <Save className="h-3 w-3" aria-hidden="true" />
          Save
        </button>
      </div>

      {/* Textarea + overlaid send button */}
      <div className="relative">
        <Textarea
          id="operator-prompt"
          ref={textareaRef}
          placeholder="Research, write, or organize your notes..."
          value={prompt}
          onChange={(e) => {
            onResetHistoryIndex();
            onPromptChange(e.target.value.slice(0, maxPromptLength));
          }}
          onKeyDown={onPromptKeyDown}
          maxLength={maxPromptLength}
          // 44px min-height tap target on mobile, taller on desktop.
          className="min-h-[80px] resize-none pr-14 text-sm"
          aria-describedby="operator-prompt-shortcuts"
        />
        <Button
          variant="brand"
          size="icon-sm"
          disabled={sendDisabled}
          onClick={onSend}
          className="absolute bottom-2 right-2"
          title={quotaTitle ?? (autoMode ? "Run now" : "Generate plan")}
          aria-label={autoMode ? "Run now" : "Generate plan"}
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Bottom metadata row */}
      <div className="flex items-center justify-between">
        <p
          id="operator-prompt-shortcuts"
          className="text-[10px] text-muted-foreground/60"
        >
          {shortcutHint}
        </p>
        {quotaReached && (
          <p className="text-[10px] text-destructive">Quota reached</p>
        )}
      </div>
    </div>
  );
}

interface ChipToggleProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  ariaLabel?: string;
}

function ChipToggle({ active, onClick, icon, label, ariaLabel }: ChipToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "border-brand/40 bg-brand/10 text-foreground"
          : "border-border bg-muted/50 text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
