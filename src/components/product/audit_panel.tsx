"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Filter, Loader2, User, Bot, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { type AuditEvent } from "@/server/domain/types/audit_event";
import { type ActorType } from "@/server/domain/constants/audit_constants";
import { AUDIT_OBJECT_TYPES } from "@/server/services/audit_view_service";
import { fetchAuditEventsAction } from "@/app/app/audit/actions";

/**
 * Audit event browser panel.
 *
 * Client component. Loads initial events from the server and supports
 * filtering by actor type and object type, plus manual refresh and
 * pagination via "load more".
 */

interface AuditPanelProps {
  initialEvents: AuditEvent[];
  workspaceId: string;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function actorIcon(actorType: string) {
  return actorType === "agent"
    ? <Bot className="h-3 w-3 shrink-0 text-muted-foreground/60" />
    : <User className="h-3 w-3 shrink-0 text-muted-foreground/60" />;
}

function eventTypeLabel(eventType: string): string {
  return eventType.replace(/\./g, " › ").replace(/_/g, " ");
}

function EventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = event.metadata && Object.keys(event.metadata).length > 0;

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => hasPayload && setExpanded((e) => !e)}
        className={cn(
          "w-full text-left px-4 py-3 transition-fast",
          hasPayload && "hover:bg-accent/40 cursor-pointer",
          !hasPayload && "cursor-default"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex items-center gap-1.5">
            {actorIcon(event.actor_type)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-foreground/80">
                {eventTypeLabel(event.event_type)}
              </span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {event.object_type}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/70">
              <span>{formatTimestamp(event.created_at)}</span>
              {event.actor_type && (
                <>
                  <span>·</span>
                  <span className="capitalize">{event.actor_type}</span>
                </>
              )}
            </div>
          </div>
          {hasPayload && (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform",
                expanded && "rotate-180"
              )}
            />
          )}
        </div>
      </button>

      {expanded && hasPayload && (
        <div className="px-4 pb-3">
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-[10px] font-mono text-foreground/70">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AuditPanel({ initialEvents, workspaceId }: AuditPanelProps) {
  const [events, setEvents] = useState<AuditEvent[]>(initialEvents);
  const [actorFilter, setActorFilter] = useState<ActorType | "">("");
  const [objectFilter, setObjectFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialEvents.length === 50);
  const [isPending, startTransition] = useTransition();
  const [showFilters, setShowFilters] = useState(false);

  function reload(opts: { actor?: ActorType | ""; object?: string; reset?: boolean }) {
    const actor = opts.actor !== undefined ? opts.actor : actorFilter;
    const object = opts.object !== undefined ? opts.object : objectFilter;
    const nextPage = opts.reset ? 1 : page;

    startTransition(async () => {
      const result = await fetchAuditEventsAction({
        workspaceId,
        actor_type: actor || undefined,
        object_type: object || undefined,
        page: nextPage,
      });

      if (result.success) {
        if (opts.reset) {
          setEvents(result.data.events);
          setPage(1);
        } else {
          setEvents((prev) => [...prev, ...result.data.events]);
        }
        setHasMore(result.data.total_fetched === result.data.limit);
      }
    });
  }

  function applyFilter(actor: ActorType | "", object: string) {
    setActorFilter(actor);
    setObjectFilter(object);
    reload({ actor, object, reset: true });
  }

  function loadMore() {
    const next = page + 1;
    setPage(next);
    startTransition(async () => {
      const result = await fetchAuditEventsAction({
        workspaceId,
        actor_type: actorFilter || undefined,
        object_type: objectFilter || undefined,
        page: next,
      });

      if (result.success) {
        setEvents((prev) => [...prev, ...result.data.events]);
        setHasMore(result.data.total_fetched === result.data.limit);
      }
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <button
          onClick={() => reload({ reset: true })}
          disabled={isPending}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast",
            "text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
          )}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>

        <button
          onClick={() => setShowFilters((f) => !f)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-fast",
            "text-muted-foreground hover:text-foreground hover:bg-accent",
            showFilters && "bg-accent text-foreground"
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Filter
          {(actorFilter || objectFilter) && (
            <span className="ml-0.5 rounded-full bg-primary w-1.5 h-1.5" />
          )}
        </button>

        {(actorFilter || objectFilter) && (
          <button
            onClick={() => applyFilter("", "")}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 bg-muted/30">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">Actor:</label>
            <select
              value={actorFilter}
              onChange={(e) => applyFilter(e.target.value as ActorType | "", objectFilter)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
            >
              <option value="">All</option>
              <option value="user">Human</option>
              <option value="agent">Agent</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">Object:</label>
            <select
              value={objectFilter}
              onChange={(e) => applyFilter(actorFilter, e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
            >
              <option value="">All</option>
              {AUDIT_OBJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <p className="text-sm">No audit events found</p>
            {(actorFilter || objectFilter) && (
              <p className="text-xs">Try clearing your filters</p>
            )}
          </div>
        ) : (
          <div>
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}

            {hasMore && (
              <div className="flex justify-center py-4">
                <button
                  onClick={loadMore}
                  disabled={isPending}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-fast",
                    "border border-border hover:bg-accent disabled:opacity-50"
                  )}
                >
                  {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
