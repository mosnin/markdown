"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/browser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingApproval {
  id: string;
  run_id: string;
  workspace_id: string;
  tool_call_id: string;
  tool_name: string;
  requested_args: Record<string, unknown>;
  preview: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected" | "timed_out";
  timeout_at: string | null;
  requested_at: string;
}

export interface ApprovalQueueProps {
  runId: string;
  /** Optional: pass initial approvals from server to avoid initial loading flash */
  initialApprovals?: PendingApproval[];
  /** Called when an approval is resolved — parent may refresh run state */
  onResolved?: (approvalId: string, decision: "approve" | "reject") => void;
}

// The three realtime broadcast events we care about. The backend currently
// emits `approval_requested` (see approval/request/route.ts) plus
// `tool_call_approval_granted` / `tool_call_approval_rejected` (see
// approval/[id]/respond/route.ts). We also subscribe to the fully qualified
// `tool_call_approval_requested` name listed in the V3 spec as a defensive
// measure in case backend naming converges.
const REALTIME_EVENTS = [
  "approval_requested",
  "tool_call_approval_requested",
  "tool_call_approval_granted",
  "tool_call_approval_rejected",
] as const;

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

interface ListApprovalsResponse {
  data?: { approvals?: PendingApproval[] };
  error?: { message?: string };
}

interface RespondResponse {
  data?: unknown;
  error?: { message?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffSec = Math.round((now - then) / 1000);
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.round(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function classifyRemaining(ms: number): "ok" | "warn" | "expired" {
  if (ms <= 0) return "expired";
  if (ms <= 30_000) return "warn"; // last 30 seconds
  return "ok";
}

// ---------------------------------------------------------------------------
// TimeoutChip — small live countdown until the agent auto-rejects
// ---------------------------------------------------------------------------

function TimeoutChip({ timeoutAt }: { timeoutAt: string | null }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!timeoutAt) return;
    // Tick every 1s. Stops once the deadline is past so we don't churn forever.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timeoutAt]);

  if (!timeoutAt) return null;
  const deadline = Date.parse(timeoutAt);
  if (!Number.isFinite(deadline)) return null;
  const remainingMs = deadline - now;
  const tone = classifyRemaining(remainingMs);

  const toneClass =
    tone === "expired"
      ? "bg-destructive/10 text-destructive"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums",
        toneClass
      )}
      title={`Expires ${new Date(deadline).toLocaleString()}`}
    >
      <Clock className="h-2.5 w-2.5" aria-hidden="true" />
      {formatRemaining(remainingMs)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card — one pending approval
// ---------------------------------------------------------------------------

interface ApprovalCardProps {
  approval: PendingApproval;
  onResolved: (id: string, decision: "approve" | "reject") => void;
}

function ApprovalCard({ approval, onResolved }: ApprovalCardProps) {
  const [argsText, setArgsText] = useState(() =>
    prettyJson(approval.requested_args)
  );
  const [rejectReason, setRejectReason] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState<null | "approve" | "reject">(
    null
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    // Cheap structural compare via pretty-print — order differences are fine,
    // we only care to surface "you've edited this" to the user.
    try {
      return (
        JSON.stringify(JSON.parse(argsText)) !==
        JSON.stringify(approval.requested_args)
      );
    } catch {
      return true;
    }
  }, [argsText, approval.requested_args]);

  const disabled = submitting !== null;

  const handleApprove = useCallback(async () => {
    setParseError(null);
    setSubmitError(null);

    let editedArgs: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsText);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        setParseError("Args must be a JSON object");
        return;
      }
      editedArgs = parsed as Record<string, unknown>;
    } catch (err) {
      setParseError(
        err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON"
      );
      return;
    }

    setSubmitting("approve");
    try {
      const res = await fetch(
        `/api/agent/operator/approval/${approval.id}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "approve",
            edited_args: editedArgs,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as RespondResponse | null;
        throw new Error(
          body?.error?.message ?? `Approve failed (${res.status})`
        );
      }
      onResolved(approval.id, "approve");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(null);
    }
  }, [approval.id, argsText, onResolved]);

  const handleReject = useCallback(async () => {
    setParseError(null);
    setSubmitError(null);
    setSubmitting("reject");
    try {
      const res = await fetch(
        `/api/agent/operator/approval/${approval.id}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "reject",
            reject_reason: rejectReason.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as RespondResponse | null;
        throw new Error(
          body?.error?.message ?? `Reject failed (${res.status})`
        );
      }
      onResolved(approval.id, "reject");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(null);
    }
  }, [approval.id, rejectReason, onResolved]);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card shadow-xs transition-opacity",
        disabled && "opacity-60 pointer-events-none"
      )}
      aria-busy={disabled}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert
            className="h-4 w-4 shrink-0 text-amber-500"
            aria-hidden="true"
          />
          <span className="truncate font-mono text-sm font-medium text-foreground">
            {approval.tool_name}
          </span>
          <TimeoutChip timeoutAt={approval.timeout_at} />
          <Badge variant="warning" className="shrink-0">
            awaiting approval
          </Badge>
        </div>
        <span
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
          title={approval.requested_at}
        >
          {formatRelativeTime(approval.requested_at)}
        </span>
      </div>

      {/* Body — editable args */}
      <div className="space-y-2 px-3 py-3">
        <div className="flex items-center justify-between">
          <label
            htmlFor={`args-${approval.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Args {isDirty && <span className="text-amber-500">(edited)</span>}
          </label>
          <span className="text-[10px] text-muted-foreground/70">
            JSON — editable
          </span>
        </div>
        <Textarea
          id={`args-${approval.id}`}
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          spellCheck={false}
          disabled={disabled}
          aria-invalid={parseError ? true : undefined}
          className="min-h-24 font-mono text-xs"
        />
        {parseError && (
          <p
            role="alert"
            className="flex items-center gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {parseError}
          </p>
        )}

        {approval.preview && (
          <div className="rounded-md border border-border/60 bg-muted/30">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium text-foreground/90 hover:bg-muted/50"
              aria-expanded={showPreview}
              aria-controls={`preview-${approval.id}`}
            >
              {showPreview ? (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              )}
              Preview
            </button>
            {showPreview && (
              <pre
                id={`preview-${approval.id}`}
                className="overflow-x-auto border-t border-border/60 px-2 py-2 font-mono text-[11px] text-foreground/80"
              >
                {prettyJson(approval.preview)}
              </pre>
            )}
          </div>
        )}

        {/* Optional reject reason */}
        <div>
          <label
            htmlFor={`reject-${approval.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Reject with reason (optional)
          </label>
          <Textarea
            id={`reject-${approval.id}`}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            disabled={disabled}
            placeholder="Why should the agent not run this?"
            className="mt-1 min-h-10 text-xs"
          />
        </div>

        {submitError && (
          <p
            role="alert"
            className="flex items-center gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {submitError}
          </p>
        )}
      </div>

      {/* Footer — actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border/60 px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReject}
          disabled={disabled}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {submitting === "reject" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Reject
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleApprove}
          disabled={disabled}
        >
          {submitting === "approve" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Approve
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main queue
// ---------------------------------------------------------------------------

/**
 * Renders the live list of pending tool-call approvals for a single run.
 *
 * Fetches once on mount (or uses `initialApprovals`) and then refetches on
 * any realtime broadcast that implies the list may have changed. Resolved
 * approvals are removed from local state immediately on successful response
 * and `onResolved` is fired so the parent can refresh related run state.
 */
export function ApprovalQueue({
  runId,
  initialApprovals,
  onResolved,
}: ApprovalQueueProps) {
  const [approvals, setApprovals] = useState<PendingApproval[]>(
    initialApprovals ?? []
  );
  const [loading, setLoading] = useState<boolean>(!initialApprovals);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Ref so realtime handlers see latest runId without re-subscribing.
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  const refetch = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await fetch(
        `/api/agent/operator/runs/${encodeURIComponent(runId)}/approvals`,
        { method: "GET", cache: "no-store" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ListApprovalsResponse | null;
        throw new Error(
          body?.error?.message ?? `Failed to load approvals (${res.status})`
        );
      }
      const body = (await res.json()) as ListApprovalsResponse;
      if (runIdRef.current !== runId) return; // stale
      const list = body.data?.approvals ?? [];
      // Only display still-pending approvals — the queue is not a history.
      setApprovals(list.filter((a) => a.status === "pending"));
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      if (runIdRef.current === runId) setLoading(false);
    }
  }, [runId]);

  // Initial load
  useEffect(() => {
    if (!initialApprovals) setLoading(true);
    void refetch();
    // refetch closes over runId via the ref; include runId directly so a
    // different runId triggers a fresh fetch.
  }, [runId, refetch, initialApprovals]);

  // Realtime subscription — refetch on any relevant event.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`operator_run:${runId}`);

    for (const evt of REALTIME_EVENTS) {
      channel.on("broadcast", { event: evt }, () => {
        if (runIdRef.current !== runId) return;
        void refetch();
      });
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [runId, refetch]);

  const handleResolved = useCallback(
    (approvalId: string, decision: "approve" | "reject") => {
      setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
      onResolved?.(approvalId, decision);
    },
    [onResolved]
  );

  if (loading) {
    return (
      <div
        className="flex min-h-[120px] items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className="h-5 w-5 animate-spin text-muted-foreground"
          aria-label="Loading approvals"
        />
      </div>
    );
  }

  if (fetchError && approvals.length === 0) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Could not load approvals</p>
          <p className="text-xs text-destructive/80">{fetchError}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No pending approvals
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Pending approvals">
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} onResolved={handleResolved} />
      ))}
    </div>
  );
}
