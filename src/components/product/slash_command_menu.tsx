"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileText,
  Info,
  Languages,
  Lightbulb,
  Link2,
  List,
  PenLine,
  Sparkles,
  Star,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BUILT_IN_COMMANDS,
  type BuiltInCommandId,
} from "@/server/domain/types/inline_command";

const BUILT_IN_ICONS: Record<BuiltInCommandId, LucideIcon> = {
  summarize: FileText,
  expand: PenLine,
  translate: Languages,
  cite: Link2,
  outline: List,
  rewrite: Sparkles,
};

// ─── Insert commands (callouts) ───────────────────────────────────────────────

export type CalloutInsertId =
  | "callout-warning"
  | "callout-tip"
  | "callout-info"
  | "callout-priority";

export const CALLOUT_INSERT_TEXT: Record<CalloutInsertId, string> = {
  "callout-warning": "> [!warning]\n> \n",
  "callout-tip": "> [!tip]\n> \n",
  "callout-info": "> [!info]\n> \n",
  "callout-priority": "> [!priority]\n> \n",
};

const CALLOUT_INSERT_COMMANDS: Array<{
  id: CalloutInsertId;
  label: string;
  description: string;
  hint: string;
  icon: LucideIcon;
}> = [
  {
    id: "callout-warning",
    label: "Warning callout",
    description: "Insert a ⚠️ warning block",
    hint: "amber callout",
    icon: AlertTriangle,
  },
  {
    id: "callout-tip",
    label: "Tip callout",
    description: "Insert a 💡 tip block",
    hint: "green callout",
    icon: Lightbulb,
  },
  {
    id: "callout-info",
    label: "Info callout",
    description: "Insert a ℹ️ info block",
    hint: "blue callout",
    icon: Info,
  },
  {
    id: "callout-priority",
    label: "Priority callout",
    description: "Insert a ⭐ priority block (high AI retrieval weight)",
    hint: "violet callout",
    icon: Star,
  },
];

export interface SkillCommandOption {
  id: string; // skill uuid
  name: string;
  description: string | null;
}

export interface SlashCommandMenuProps {
  /** Coordinates in CSS pixels, relative to the viewport. */
  anchor: { top: number; left: number } | null;
  /** The filter text typed after the `/`. */
  query: string;
  /** Skills exposed as sub-agents; fetched by parent. */
  skillCommands: SkillCommandOption[];
  /** User selected a command — parent dispatches it. */
  onSelect: (
    selection:
      | { kind: "builtin"; id: BuiltInCommandId }
      | { kind: "skill"; id: string }
      | { kind: "insert"; id: CalloutInsertId }
  ) => void;
  onDismiss: () => void;
}

/**
 * Floating menu shown when the user types `/` in the CRDT note editor.
 *
 * Purely presentational — parent owns all state. We do our own keyboard
 * navigation because the CodeMirror view has focus; intercepting the
 * host's keydown events bypasses native focus quirks.
 */
export function SlashCommandMenu({
  anchor,
  query,
  skillCommands,
  onSelect,
  onDismiss,
}: SlashCommandMenuProps) {
  const items = useMemo(() => {
    const builtIn = BUILT_IN_COMMANDS.map((cmd) => ({
      kind: "builtin" as const,
      id: cmd.id,
      label: cmd.label,
      hint: cmd.hint,
      description: cmd.description,
      icon: BUILT_IN_ICONS[cmd.id as BuiltInCommandId] as LucideIcon,
    }));
    const callouts = CALLOUT_INSERT_COMMANDS.map((cmd) => ({
      kind: "insert" as const,
      id: cmd.id,
      label: cmd.label,
      hint: cmd.hint,
      description: cmd.description,
      icon: cmd.icon,
    }));
    const skills = skillCommands.map((s) => ({
      kind: "skill" as const,
      id: s.id,
      label: s.name,
      hint: "Workspace skill",
      description: s.description ?? "",
      icon: Workflow as LucideIcon,
    }));
    const all = [...callouts, ...builtIn, ...skills];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
    );
  }, [skillCommands, query]);

  const [highlight, setHighlight] = useState(0);
  const [resetKey, setResetKey] = useState(`${query}:${items.length}`);
  const currentKey = `${query}:${items.length}`;
  if (resetKey !== currentKey) {
    setResetKey(currentKey);
    setHighlight(0);
  }

  useEffect(() => {
    if (!anchor) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (items.length === 0 ? 0 : (h + 1) % items.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) =>
          items.length === 0 ? 0 : (h - 1 + items.length) % items.length
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[highlight];
        if (item) {
          if (item.kind === "builtin") {
            onSelect({ kind: "builtin", id: item.id as BuiltInCommandId });
          } else if (item.kind === "insert") {
            onSelect({ kind: "insert", id: item.id as CalloutInsertId });
          } else {
            onSelect({ kind: "skill", id: item.id });
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    }

    // Capture phase so we run before CodeMirror's own keymap.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [anchor, items, highlight, onSelect, onDismiss]);

  if (!anchor) return null;
  if (items.length === 0) {
    return (
      <div
        role="menu"
        aria-label="Slash commands"
        className={cn(
          "fixed z-50 w-72 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg",
          "text-xs text-muted-foreground"
        )}
        style={{ top: anchor.top, left: anchor.left }}
      >
        No matching commands for &ldquo;{query}&rdquo;
      </div>
    );
  }

  return (
    <div
      role="menu"
      aria-label="Slash commands"
      className={cn(
        "fixed z-50 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
      )}
      style={{ top: anchor.top, left: anchor.left }}
    >
      <ul className="max-h-72 list-none overflow-y-auto py-1">
        {items.map((item, idx) => {
          const Icon = item.icon ?? Workflow;
          const isActive = idx === highlight;
          return (
            <li key={`${item.kind}:${item.id}`}>
              <button
                type="button"
                role="menuitem"
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => {
                  if (item.kind === "builtin") {
                    onSelect({ kind: "builtin", id: item.id as BuiltInCommandId });
                  } else if (item.kind === "insert") {
                    onSelect({ kind: "insert", id: item.id as CalloutInsertId });
                  } else {
                    onSelect({ kind: "skill", id: item.id });
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  "transition-colors",
                  isActive ? "bg-accent" : "hover:bg-accent/60"
                )}
              >
                <Icon
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {item.label}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {item.description || item.hint}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {item.kind === "skill"
                    ? "skill"
                    : item.kind === "insert"
                    ? "insert"
                    : item.hint}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
