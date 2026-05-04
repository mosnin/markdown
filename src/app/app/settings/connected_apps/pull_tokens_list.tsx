"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bot,
  Box as BoxIcon,
  ChevronDown,
  ChevronUp,
  FileText,
  Layers,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  listPullTokensAction,
  revokePullTokenAction,
  type PullTokenRow,
} from "./pull_tokens_actions";

/**
 * Pull links — settings sub-tab.
 *
 * Lists every short-lived pull-token the signed-in user has issued
 * for AI agents to fetch context. Each token can be revoked inline;
 * revocation is reversible (issue a new token), so we skip the
 * confirmation dialog and rely on optimistic UI + a tiny "Revoked"
 * badge replacing the action button.
 *
 * Two buckets:
 *   - **Active** — not revoked, expiry in the future. Default open.
 *   - **Expired or revoked** — collapsed, expandable on click.
 *
 * The two split out a single source list returned by
 * `listPullTokensAction`; we filter client-side so the bucket counts
 * stay in sync with optimistic state.
 */
export function PullTokensList({
  onActiveCountChange,
}: {
  /** Bubble the live "active" count up so the parent tab badge can render it. */
  onActiveCountChange?: (count: number) => void;
}) {
  const [rows, setRows] = useState<PullTokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [showInactive, setShowInactive] = useState(false);
  const [optimisticRevokes, setOptimisticRevokes] = useState<
    Record<string, string>
  >({});

  const refresh = () => {
    startLoad(async () => {
      const res = await listPullTokensAction();
      if (res.ok) {
        setRows(res.data);
        setError(null);
        setOptimisticRevokes({});
      } else {
        setError(res.error);
        setRows([]);
      }
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  // Snapshot "now" once per refresh cycle so the bucket boundary
  // doesn't drift mid-render. Refreshed when `rows` change (i.e. the
  // server list comes back) — the user can also click the parent
  // "OAuth apps" tab and back to force a re-render.
  const nowRef = useRef<number>(Date.now());
  // Refresh the snapshot when the server list refreshes.
  useEffect(() => {
    nowRef.current = Date.now();
  }, [rows]);

  // Apply optimistic revokes on top of the server list, then split.
  const { merged, activeRows, inactiveRows } = useMemo(() => {
    const m: PullTokenRow[] = (rows ?? []).map((r) =>
      optimisticRevokes[r.id]
        ? { ...r, revokedAt: optimisticRevokes[r.id] }
        : r
    );
    const ts = nowRef.current;
    const isActive = (r: PullTokenRow) =>
      !r.revokedAt && new Date(r.expiresAt).getTime() > ts;
    return {
      merged: m,
      activeRows: m.filter(isActive),
      inactiveRows: m.filter((r) => !isActive(r)),
    };
  }, [rows, optimisticRevokes]);
  void merged;

  useEffect(() => {
    onActiveCountChange?.(activeRows.length);
  }, [activeRows.length, onActiveCountChange]);

  function onRevoke(row: PullTokenRow) {
    const stamped = new Date().toISOString();
    setOptimisticRevokes((m) => ({ ...m, [row.id]: stamped }));
    void (async () => {
      const res = await revokePullTokenAction(row.id);
      if (!res.ok) {
        // Roll back on failure
        setOptimisticRevokes((m) => {
          const next = { ...m };
          delete next[row.id];
          return next;
        });
        setError(res.error);
      }
    })();
  }

  if (rows === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? "Loading pull links…" : ""}
      </p>
    );
  }

  if (rows.length === 0 && !error) {
    return (
      <Card>
        <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
          <p>No pull links yet.</p>
          <p className="mt-1 text-xs">
            When you use <span className="font-medium">Send to AI</span> on a
            note, box, skill, or agent, a short-lived pull link appears here so
            you can see what&apos;s in flight and revoke any link instantly.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active ({activeRows.length})
          </h2>
          {activeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active pull links.
            </p>
          ) : (
            <ul className="flex list-none flex-col gap-2">
              {activeRows.map((r) => (
                <li key={r.id}>
                  <PullTokenRowCard row={r} onRevoke={() => onRevoke(r)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {inactiveRows.length > 0 && (
          <section>
            <button
              type="button"
              aria-expanded={showInactive}
              onClick={() => setShowInactive((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {showInactive ? (
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
              Expired or revoked ({inactiveRows.length})
            </button>
            {showInactive && (
              <ul className="mt-2 flex list-none flex-col gap-2">
                {inactiveRows.map((r) => (
                  <li key={r.id}>
                    <PullTokenRowCard row={r} onRevoke={() => undefined} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </TooltipProvider>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

const OBJECT_ICONS = {
  note: FileText,
  box: BoxIcon,
  skill: Wrench,
  agent: Bot,
  bundle: Layers,
} as const;

function PullTokenRowCard({
  row,
  onRevoke,
}: {
  row: PullTokenRow;
  onRevoke: () => void;
}) {
  // Snapshot "now" at mount; bucket-boundary correctness is the
  // parent's responsibility (it re-derives on `rows` change).
  const nowRef = useRef<number>(Date.now());
  const isRevoked = !!row.revokedAt;
  const isExpired =
    !isRevoked && new Date(row.expiresAt).getTime() <= nowRef.current;
  const inactive = isRevoked || isExpired;
  const Icon = OBJECT_ICONS[row.objectType] ?? Sparkles;

  const expiresLabel = computeExpiresLabel(
    row.expiresAt,
    isRevoked,
    nowRef.current
  );
  const lastRedemption = row.lastRedeemedAt
    ? formatRelative(row.lastRedeemedAt, nowRef.current)
    : "never used";

  const ua = (row.lastUserAgent ?? "").trim();

  return (
    <Card className={cn(inactive && "opacity-60")}>
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {row.objectType}
              </span>
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  row.objectDeleted && "italic text-muted-foreground"
                )}
              >
                &ldquo;{row.objectName}&rdquo;
              </span>
              {row.writeCapable ? (
                <Badge variant="brand-subtle" className="text-[10px]">
                  Allow edits
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Read-only
                </Badge>
              )}
              {isRevoked && (
                <Badge variant="outline" className="text-[10px]">
                  Revoked
                </Badge>
              )}
              {isExpired && !isRevoked && (
                <Badge variant="outline" className="text-[10px]">
                  Expired
                </Badge>
              )}
            </div>

            <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.tokenPrefix}
            </p>

            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
              <div className="truncate">
                <dt className="inline font-medium">
                  {isRevoked ? "Revoked:" : isExpired ? "Expired:" : "Expires"}
                  {isRevoked || isExpired ? "" : " in:"}
                </dt>{" "}
                <span className="font-mono tabular-nums">{expiresLabel}</span>
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Last used:</dt>{" "}
                <span className="font-mono tabular-nums">{lastRedemption}</span>
              </div>
              <div className="truncate">
                <dt className="inline font-medium">Redemptions:</dt>{" "}
                <span className="font-mono tabular-nums">
                  {row.redemptionCount} / {row.maxRedemptions}
                </span>
              </div>
              {ua && (
                <div className="truncate">
                  <dt className="inline font-medium">Last UA:</dt>{" "}
                  <Tooltip>
                    <TooltipTrigger
                      render={(props) => (
                        <span
                          {...props}
                          className="cursor-help truncate font-mono"
                        >
                          {truncateUa(ua)}
                        </span>
                      )}
                    />
                    <TooltipContent>{ua}</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </dl>
          </div>

          <div className="shrink-0">
            {inactive ? (
              <Badge variant="outline" className="text-[10px]">
                {isRevoked ? "Revoked" : "Expired"}
              </Badge>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRevoke}
                aria-label={`Revoke pull link for ${row.objectName}`}
              >
                Revoke
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute a "Expires in N min" label.
 *
 * Pure function — `now` is passed in by the caller (the row uses a
 * `nowRef` snapshot taken at mount) so React's purity rules don't
 * fight us. The trade-off: long-lived sessions don't tick the label
 * down second-by-second, which is a deliberate choice (the style
 * brief discourages auto-loop motion).
 */
function computeExpiresLabel(
  expiresAt: string,
  isRevoked: boolean,
  now: number
): string {
  if (isRevoked) return "—";
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) {
    const ago = Math.abs(ms);
    return `${humanize(ago)} ago`;
  }
  return humanize(ms);
}

function humanize(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} d`;
}

function formatRelative(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 0) return "just now";
  if (ms < 60_000) return "just now";
  return `${humanize(ms)} ago`;
}

function truncateUa(ua: string): string {
  // Show the first ~28 chars to fit the row; the tooltip surfaces
  // the full string for the curious.
  if (ua.length <= 28) return ua;
  return `${ua.slice(0, 28)}…`;
}
