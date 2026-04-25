"use client";

/**
 * NoteSelectionToolbar
 *
 * A floating mini-toolbar that appears when the user selects text inside the
 * note editor. Rendered into document.body via a React portal so it is never
 * clipped by overflow:hidden containers.
 *
 * Supported actions:
 *   Summarize | Expand | Rewrite | → Note (create linked note from selection)
 *
 * Each action stashes the selected text + a command prompt into sessionStorage
 * and fires the global OPEN_OPERATOR_EVENT so the workspace operator panel
 * opens with a pre-filled prompt.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { FileText, Maximize2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { OPEN_OPERATOR_EVENT } from "@/components/product/operator/operator_panel_trigger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolbarPosition {
  top: number;
  left: number;
}

interface NoteSelectionToolbarProps {
  /** id attribute of the editor container — used to scope selection checks */
  editorContainerId?: string;
  /** Title of the current note — injected into operator prompts */
  noteTitle: string;
  /** Box id passed along for operator context */
  boxId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stashAndOpenOperator(prompt: string): void {
  try {
    window.sessionStorage.setItem("poggle:pending-prompt", prompt);
  } catch {
    // sessionStorage blocked — panel will still open without prefill
  }
  window.dispatchEvent(new Event(OPEN_OPERATOR_EVENT));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NoteSelectionToolbar({
  editorContainerId,
  noteTitle,
  boxId: _boxId,
}: NoteSelectionToolbarProps) {
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const [selectedText, setSelectedText] = useState<string>("");
  const toolbarRef = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => {
    setPosition(null);
    setSelectedText("");
  }, []);

  // Listen for selection changes
  useEffect(() => {
    function onSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        hide();
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        hide();
        return;
      }

      // Scope check — only show when selection is within the editor container
      if (editorContainerId) {
        const container = document.getElementById(editorContainerId);
        if (container) {
          const range = selection.getRangeAt(0);
          if (!container.contains(range.commonAncestorContainer)) {
            hide();
            return;
          }
        }
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide();
        return;
      }

      const TOOLBAR_HEIGHT = 36; // px
      const OFFSET = 8; // gap between toolbar and selection
      const TOOLBAR_WIDTH = 260; // approximate

      let top = rect.top + window.scrollY - TOOLBAR_HEIGHT - OFFSET;
      // Flip below selection if too close to top of viewport
      if (top < window.scrollY + 4) {
        top = rect.bottom + window.scrollY + OFFSET;
      }

      let left = rect.left + window.scrollX + rect.width / 2 - TOOLBAR_WIDTH / 2;
      // Clamp to viewport
      left = Math.max(8, Math.min(left, window.innerWidth - TOOLBAR_WIDTH - 8));

      setSelectedText(text);
      setPosition({ top, left });
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [editorContainerId, hide]);

  // Hide when user clicks outside the toolbar
  useEffect(() => {
    if (!position) return;

    function onPointerDown(e: PointerEvent) {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        // Don't hide immediately on mousedown — the selectionchange listener
        // will clear on the next tick if the selection collapses.
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [position]);

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------

  function handleSummarize() {
    if (!selectedText) return;
    const prompt = `Summarize the following selected text from the note titled "${noteTitle}". Return a concise 2-3 sentence summary that captures the main ideas:\n\n---\n${selectedText}\n---`;
    stashAndOpenOperator(prompt);
    hide();
  }

  function handleExpand() {
    if (!selectedText) return;
    const prompt = `Expand the following selected text from the note titled "${noteTitle}". Add supporting detail, examples, or context while preserving the original tone and intent. Output only the expanded version:\n\n---\n${selectedText}\n---`;
    stashAndOpenOperator(prompt);
    hide();
  }

  function handleRewrite() {
    if (!selectedText) return;
    const prompt = `Rewrite the following selected text from the note titled "${noteTitle}" for improved clarity, flow, and conciseness. Preserve the meaning and key information:\n\n---\n${selectedText}\n---`;
    stashAndOpenOperator(prompt);
    hide();
  }

  function handleCreateNote() {
    if (!selectedText) return;
    const prompt = `Create a new note from the following selected text taken from the note titled "${noteTitle}". The new note should:\n1. Have a clear, descriptive title\n2. Use the selected text as its main content\n3. Include a backlink reference to the source note "${noteTitle}"\n4. Add any helpful context or structure\n\nSelected text:\n---\n${selectedText}\n---`;
    stashAndOpenOperator(prompt);
    hide();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!position || !selectedText) return null;

  const toolbar = (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Text selection actions"
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-1 shadow-lg",
        "animate-in fade-in-0 zoom-in-95 duration-100"
      )}
      // Prevent the toolbar itself from stealing selection
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarButton
        icon={<Sparkles className="h-3 w-3" />}
        label="Summarize"
        onClick={handleSummarize}
      />
      <ToolbarButton
        icon={<Maximize2 className="h-3 w-3" />}
        label="Expand"
        onClick={handleExpand}
      />
      <ToolbarButton
        icon={<RefreshCw className="h-3 w-3" />}
        label="Rewrite"
        onClick={handleRewrite}
      />
      <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      <ToolbarButton
        icon={<FileText className="h-3 w-3" />}
        label="→ Note"
        onClick={handleCreateNote}
      />
    </div>
  );

  // Render into document.body to escape overflow:hidden containers
  if (typeof document === "undefined") return null;
  return createPortal(toolbar, document.body);
}

// ---------------------------------------------------------------------------
// ToolbarButton
// ---------------------------------------------------------------------------

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
        "text-foreground/80 transition-colors",
        "hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
