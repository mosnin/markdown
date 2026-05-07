"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  History,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  Check,
  X,
  Pencil,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface OperatorSessionsDrawerProps {
  /** Currently active session id, if any. */
  activeSessionId?: string | null;
  /**
   * Optional handler invoked when the user picks a session row. When
   * omitted, the drawer falls back to navigating to the workspace
   * operator route so the trigger works from any `<PageHeader>` slot.
   */
  onSelectSession?: (session: OperatorSession) => void;
  /**
   * Optional handler invoked when the user creates a new session. When
   * omitted, the drawer falls back to navigation just like
   * `onSelectSession`.
   */
  onNewSession?: (session: OperatorSession) => void;
  /**
   * Optional override for the trigger button label — defaults to
   * "Sessions". Pass a different label for surfaces where that wording
   * collides with another control.
   */
  triggerLabel?: string;
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export function OperatorSessionsDrawer({
  activeSessionId = null,
  onSelectSession,
  onNewSession,
  triggerLabel = "Sessions",
}: OperatorSessionsDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<OperatorSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [query, setQuery] = useState("");
  const [isCreating, startCreateTransition] = useTransition();

  // Defer the first fetch until the drawer is first opened, then keep
  // the cached list around so subsequent opens feel instant. We still
  // refresh in the background on every open so a recently-created
  // session in another tab doesn't go stale.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (!hasLoadedOnce) setLoading(true);
    listSessionsAction().then((res) => {
      if (cancelled) return;
      if (res.ok) setSessions(res.data);
      setLoading(false);
      setHasLoadedOnce(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, hasLoadedOnce]);

  function handleNewSession() {
    startCreateTransition(async () => {
      const name = `Session ${new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`;
      const res = await createSessionAction(name);
      if (res.ok) {
        setSessions((prev) => [res.data, ...prev]);
        if (onNewSession) {
          onNewSession(res.data);
        } else {
          // Fallback when the drawer is mounted from a `<PageHeader>`
          // without a host that owns session state — head to the
          // operator landing route, which will pick up the new session.
          router.push("/app/workspace_operator");
          router.refresh();
        }
        setOpen(false);
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
  }

  function handleSelect(session: OperatorSession) {
    if (onSelectSession) {
      onSelectSession(session);
    } else {
      // Fallback — navigate back to the operator landing route. The
      // route will surface this session via its own URL params.
      router.push("/app/workspace_operator");
      router.refresh();
    }
    setOpen(false);
  }

  const normalisedQuery = query.trim().toLowerCase();
  const filteredSessions = normalisedQuery
    ? sessions.filter((s) => s.name.toLowerCase().includes(normalisedQuery))
    : sessions;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <History aria-hidden="true" />
            {triggerLabel}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-sm"
        aria-describedby="operator-sessions-drawer-desc"
      >
        <SheetHeader className="gap-1 border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Sessions
          </SheetTitle>
          <SheetDescription
            id="operator-sessions-drawer-desc"
            className="text-xs"
          >
            Switch between past Operator sessions or start a new one.
          </SheetDescription>
        </SheetHeader>

        {/* Search + new session CTA */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter sessions"
              aria-label="Filter sessions"
              className={cn(
                "w-full rounded-md border border-border bg-card pl-8 pr-2 text-sm",
                "h-9 sm:h-8",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            />
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleNewSession}
            disabled={isCreating}
            aria-label="New session"
          >
            {isCreating ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            New
          </Button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {loading && !hasLoadedOnce ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <MessageSquare
                className="h-6 w-6 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-base font-medium text-foreground">
                {sessions.length === 0
                  ? "No sessions yet"
                  : "No matching sessions"}
              </p>
              <p className="max-w-[24ch] text-sm text-muted-foreground">
                {sessions.length === 0
                  ? "Start a new session to begin a fresh conversation."
                  : "Try a different filter or clear the search."}
              </p>
              {sessions.length === 0 && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleNewSession}
                  disabled={isCreating}
                  className="mt-2"
                >
                  {isCreating ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                  New session
                </Button>
              )}
            </div>
          ) : (
            <ul
              className="divide-y divide-border"
              role="list"
              aria-label="Operator sessions"
            >
              {filteredSessions.map((session) => (
                <li key={session.id}>
                  <SessionRow
                    session={session}
                    isActive={session.id === activeSessionId}
                    onSelect={() => handleSelect(session)}
                    onRename={handleRename}
                    onDelete={handleDelete}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
          "flex min-h-11 items-center gap-2 px-4 py-2",
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
          aria-label="Session name"
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={80}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCommitEdit}
          disabled={isRenaming}
          aria-label="Save name"
        >
          {isRenaming ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Check aria-hidden="true" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCancelEdit}
          aria-label="Cancel rename"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex min-h-11 cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors",
        "hover:bg-accent",
        "focus-within:bg-accent",
        isActive && "bg-accent"
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-pressed={isActive}
    >
      {/* Active indicator — brand-yellow accent only on the active row.
          Hairline pill on the left edge keeps the rest of the row neutral. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full",
          isActive ? "bg-brand" : "bg-transparent"
        )}
      />

      {/* Run-count chip */}
      <div
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-medium",
          isActive
            ? "bg-card text-foreground border border-border"
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
            "truncate text-sm leading-snug",
            isActive
              ? "font-medium text-foreground"
              : "text-foreground/90"
          )}
        >
          {session.name}
        </p>
        <p className="text-xs text-muted-foreground">{timeAgo}</p>
      </div>

      {/* Row actions — keyboard-reachable, but visually quiet until
          hover/focus so the row stays uncluttered. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5",
          "opacity-0 transition-opacity duration-150 ease-out",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          (isDeleting || isRenaming) && "opacity-100",
          "motion-reduce:transition-none"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleStartEdit}
          aria-label={`Rename ${session.name}`}
          title="Rename"
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label={`Delete ${session.name}`}
          title="Delete"
        >
          {isDeleting ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Trash2 aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
