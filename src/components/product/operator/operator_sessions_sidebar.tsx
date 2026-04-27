"use client";

import { useState, useEffect, useTransition } from "react";
import {
  MessageSquare,
  Plus,
  Trash2,
  Check,
  X,
  Pencil,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listSessionsAction,
  createSessionAction,
  renameSessionAction,
  deleteSessionAction,
} from "@/app/app/workspace_operator/sessions_actions";
import type { OperatorSession } from "@/server/services/operator_sessions_service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface OperatorSessionsSidebarProps {
  activeSessionId: string | null;
  onSelectSession: (session: OperatorSession) => void;
  onNewSession: (session: OperatorSession) => void;
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function OperatorSessionsSidebar({
  activeSessionId,
  onSelectSession,
  onNewSession,
}: OperatorSessionsSidebarProps) {
  const [sessions, setSessions] = useState<OperatorSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, startCreateTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listSessionsAction().then((res) => {
      if (cancelled) return;
      if (res.ok) setSessions(res.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleNewSession() {
    startCreateTransition(async () => {
      const name = `Session ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      const res = await createSessionAction(name);
      if (res.ok) {
        setSessions((prev) => [res.data, ...prev]);
        onNewSession(res.data);
      }
    });
  }

  function handleRename(sessionId: string, newName: string) {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, name: newName } : s))
    );
  }

  function handleDelete(sessionId: string) {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    // If deleted session was active, caller should handle deselection
  }

  return (
    <div className="flex h-full flex-col border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sessions
        </span>
        <button
          type="button"
          onClick={handleNewSession}
          disabled={isCreating}
          className={cn(
            "flex items-center justify-center rounded-md p-1",
            "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:opacity-50"
          )}
          aria-label="New session"
          title="New session"
        >
          {isCreating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <MessageSquare className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">
              No sessions yet. Start a new one.
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={() => onSelectSession(session)}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── SessionRow ───────────────────────────────────────────────────────────────

interface SessionRowProps {
  session: OperatorSession;
  isActive: boolean;
  onSelect: () => void;
  onRename: (sessionId: string, newName: string) => void;
  onDelete: (sessionId: string) => void;
}

function SessionRow({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: SessionRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.name);
  const [isRenaming, startRenameTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [showActions, setShowActions] = useState(false);

  function handleStartEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(session.name);
    setIsEditing(true);
  }

  function handleCancelEdit() {
    setIsEditing(false);
    setEditValue(session.name);
  }

  function handleCommitEdit() {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === session.name) {
      handleCancelEdit();
      return;
    }
    startRenameTransition(async () => {
      const res = await renameSessionAction(session.id, trimmed);
      if (res.ok) {
        onRename(session.id, res.data.name);
      }
      setIsEditing(false);
    });
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    startDeleteTransition(async () => {
      const res = await deleteSessionAction(session.id);
      if (res.ok) {
        onDelete(session.id);
      }
    });
  }

  const timeAgo = relativeTime(session.last_run_at ?? session.created_at);

  if (isEditing) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1.5",
          isActive && "bg-accent"
        )}
      >
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCommitEdit();
            if (e.key === "Escape") handleCancelEdit();
          }}
          className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          maxLength={80}
        />
        <button
          type="button"
          onClick={handleCommitEdit}
          disabled={isRenaming}
          className="shrink-0 text-green-600 hover:text-green-700 dark:text-green-400"
          aria-label="Save"
        >
          {isRenaming ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          onClick={handleCancelEdit}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-start gap-2 px-2 py-2 transition-colors",
        "hover:bg-accent",
        isActive && "bg-accent"
      )}
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      aria-pressed={isActive}
    >
      {/* Run count indicator */}
      <div
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-medium",
          isActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
        aria-hidden="true"
      >
        {session.run_count > 9 ? "9+" : session.run_count || "0"}
      </div>

      {/* Name + time */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-xs leading-snug",
            isActive ? "font-medium text-foreground" : "text-foreground/80"
          )}
        >
          {session.name}
        </p>
        <p className="text-[10px] text-muted-foreground/60">{timeAgo}</p>
      </div>

      {/* Actions — only visible on hover / focus */}
      {(showActions || isDeleting) && (
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <button
            type="button"
            onClick={handleStartEdit}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-background/50"
            aria-label="Rename session"
            title="Rename"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-background/50"
            aria-label="Delete session"
            title="Delete"
          >
            {isDeleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
