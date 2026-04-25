"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock,
  FilePlus,
  PenLine,
  RefreshCcw,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type WriteProposal } from "@/server/domain/types/write_proposal";
import { type Note } from "@/server/domain/types/note";
import { type Connection } from "@/server/domain/types/connection";
import { type CurrentObjectSnapshot } from "@/server/services/write_proposal_service";
import { HeterogeneousProposalCard } from "@/components/product/heterogeneous_proposal_card";
import {
  approveProposalAction,
  rejectProposalAction,
} from "@/app/app/proposals/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalWithContext {
  proposal: WriteProposal;
  connection: Connection | null;
  current_note: Note | null;
  current_object: CurrentObjectSnapshot | null;
  preview_content: string | null;
}

interface ProposalsPanelProps {
  initialProposals: ProposalWithContext[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const PROPOSAL_TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; className: string }
> = {
  create_note:  { label: "Create note",    icon: FilePlus,        className: "bg-muted text-muted-foreground" },
  update_note:  { label: "Update note",    icon: PenLine,         className: "bg-muted text-muted-foreground" },
  append_note:  { label: "Append to note", icon: ArrowDownToLine, className: "bg-muted text-muted-foreground" },
  replace_note: { label: "Replace note",   icon: RefreshCcw,      className: "bg-destructive/10 text-destructive" },
};

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon: React.ElementType }
> = {
  pending:    { label: "Pending review", className: "bg-warning/15 text-warning border-warning/30",                icon: Clock },
  approved:   { label: "Approved",       className: "bg-success/15 text-success border-success/30",                icon: Check },
  rejected:   { label: "Rejected",       className: "bg-muted text-muted-foreground border-border",                 icon: X },
  conflicted: { label: "Conflicted",     className: "bg-destructive/15 text-destructive border-destructive/30",    icon: AlertTriangle },
  canceled:   { label: "Canceled",       className: "bg-muted text-muted-foreground border-border",                 icon: XCircle },
  expired:    { label: "Expired",        className: "bg-muted text-muted-foreground border-border",                 icon: Clock },
};

const STATUS_TABS = ["pending", "approved", "rejected", "conflicted", "all"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, max = 300) {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        cfg.className
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ─── TypeBadge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const cfg = PROPOSAL_TYPE_CONFIG[type] ?? PROPOSAL_TYPE_CONFIG.update_note;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        cfg.className
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ─── ContentBlock ─────────────────────────────────────────────────────────────

function ContentBlock({
  label,
  content,
  labelMuted,
}: {
  label: string;
  content: string | null;
  labelMuted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!content) return null;
  const long = content.length > 300;
  const displayed = expanded || !long ? content : truncate(content, 300);

  return (
    <div className="space-y-1">
      <p
        className={cn(
          "text-xs font-medium",
          labelMuted ? "text-muted-foreground/60" : "text-muted-foreground"
        )}
      >
        {label}
      </p>
      <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-wrap font-mono">
        {displayed}
      </pre>
      {long && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <><ChevronUp className="h-3 w-3" /> Show less</>
          ) : (
            <><ChevronDown className="h-3 w-3" /> Show more</>
          )}
        </button>
      )}
    </div>
  );
}

// ─── ProposalContentPreview ───────────────────────────────────────────────────

/**
 * Type-aware content preview.
 *
 * - create_note: new note content only
 * - append_note: current note (muted) → visual separator → new portion being appended
 * - replace_note: current content (muted, labeled "will be replaced") → replacement
 * - update_note: current → proposed side-by-side (stacked)
 */
function ProposalContentPreview({
  proposal,
  currentNote,
  previewContent,
}: {
  proposal: WriteProposal;
  currentNote: Note | null;
  previewContent: string | null;
}) {
  const type = proposal.proposal_type;

  if (type === "create_note") {
    return <ContentBlock label="New note content" content={previewContent} />;
  }

  if (type === "append_note") {
    return (
      <div className="space-y-2">
        <ContentBlock
          label="Current note"
          content={currentNote?.markdown_content ?? null}
          labelMuted
        />
        <div className="flex items-center gap-2 py-0.5">
          <div className="h-px flex-1 bg-border/50" />
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <ArrowDownToLine className="h-2.5 w-2.5" />
            appending below
          </span>
          <div className="h-px flex-1 bg-border/50" />
        </div>
        <div className="border-l-2 border-primary/40 pl-2">
          <ContentBlock
            label="New content to append"
            content={proposal.proposed_content}
          />
        </div>
      </div>
    );
  }

  if (type === "replace_note") {
    return (
      <div className="space-y-3">
        <ContentBlock
          label="Current content — will be replaced"
          content={currentNote?.markdown_content ?? null}
          labelMuted
        />
        <div className="border-l-2 border-destructive/50 pl-2">
          <ContentBlock label="Replacement content" content={previewContent} />
        </div>
      </div>
    );
  }

  // update_note
  return (
    <div className="space-y-3">
      <ContentBlock
        label="Current content"
        content={currentNote?.markdown_content ?? null}
        labelMuted
      />
      <ContentBlock label="Proposed content" content={previewContent} />
    </div>
  );
}

// ─── ProposalCard ─────────────────────────────────────────────────────────────

function ProposalCard({
  item,
  onUpdate,
  isSelected,
  onToggleSelect,
}: {
  item: ProposalWithContext;
  onUpdate: (id: string, newStatus: string) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const { proposal, connection, current_note, preview_content } = item;
  const [reviewNote, setReviewNote] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isPendingProposal = proposal.status === "pending";
  const isConflicted = proposal.status === "conflicted";
  const isReplace = proposal.proposal_type === "replace_note";

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveProposalAction(proposal.id, reviewNote || undefined);
      if (result.success) {
        const data = result.data as { outcome: string };
        onUpdate(proposal.id, data.outcome === "approved" ? "approved" : "conflicted");
      } else {
        setError(result.error);
      }
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectProposalAction(proposal.id, reviewNote || undefined);
      if (result.success) {
        onUpdate(proposal.id, "rejected");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card
      className={cn(
        "border transition-colors relative",
        isConflicted && "border-destructive/40 bg-destructive/5",
        isPendingProposal && isReplace && !isConflicted && "border-destructive/30",
        isSelected && "ring-2 ring-violet-500/40 border-violet-500/30"
      )}
    >
      <CardHeader className="pb-2">
        {/* Checkbox for batch selection — only on pending proposals */}
        {isPendingProposal && onToggleSelect && (
          <div className="absolute top-3 left-3">
            <input
              type="checkbox"
              checked={isSelected ?? false}
              onChange={() => onToggleSelect(proposal.id)}
              aria-label={`Select proposal for ${proposal.proposed_title ?? current_note?.title ?? "this note"}`}
              className="h-4 w-4 rounded border-border accent-violet-500 cursor-pointer"
            />
          </div>
        )}
        <div className={cn("flex flex-col gap-1.5", isPendingProposal && onToggleSelect && "pl-7")}>
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={proposal.proposal_type} />
            <StatusBadge status={proposal.status} />
          </div>

          {proposal.proposed_title && (
            <p className="text-sm font-medium truncate">{proposal.proposed_title}</p>
          )}
          {!proposal.proposed_title && current_note && (
            <p className="text-sm font-medium truncate text-muted-foreground">
              → {current_note.title}
            </p>
          )}
        </div>

        <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", isPendingProposal && onToggleSelect && "pl-7")}>
          {connection && (
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {connection.name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(proposal.created_at)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {/* Agent's Reasoning callout — shown first so reviewers read why before seeing what */}
        {proposal.rationale && (
          <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-400 mb-1">
              Agent&apos;s Reasoning
            </p>
            <p className="text-sm text-foreground">{proposal.rationale}</p>
          </div>
        )}

        {/* Conflict notice */}
        {isConflicted && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">
              The note was modified after this proposal was created. The proposal
              is now stale and cannot be applied.
            </p>
          </div>
        )}

        {/* Replace warning */}
        {isReplace && isPendingProposal && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-xs text-warning">
              This is a full replacement. Approving will overwrite the current note
              content entirely.
            </p>
          </div>
        )}

        {/* Content preview toggle */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showDetails ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {showDetails ? "Hide" : "Show"} content preview
        </button>

        {showDetails && (
          <div className="space-y-3">
            <ProposalContentPreview
              proposal={proposal}
              currentNote={current_note}
              previewContent={preview_content}
            />

            {proposal.proposed_tags && proposal.proposed_tags.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Proposed tags</p>
                <div className="flex flex-wrap gap-1">
                  {proposal.proposed_tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reviewed info */}
        {!isPendingProposal && proposal.reviewed_at && (
          <p className="text-xs text-muted-foreground">
            Reviewed {formatDate(proposal.reviewed_at)}
            {proposal.review_note && ` — "${proposal.review_note}"`}
          </p>
        )}

        {/* Actions */}
        {isPendingProposal && (
          <div className="space-y-2 pt-1">
            <Separator />

            {showReviewForm && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Review note (optional)
                </label>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Add a comment for the connection or for your records…"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={isPending}
                className="gap-1.5"
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReject}
                disabled={isPending}
                className="gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </Button>
              <button
                onClick={() => setShowReviewForm(!showReviewForm)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                {showReviewForm ? "Cancel comment" : "Add comment"}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ProposalsPanel ───────────────────────────────────────────────────────────

export function ProposalsPanel({ initialProposals }: ProposalsPanelProps) {
  const [proposals, setProposals] =
    useState<ProposalWithContext[]>(initialProposals);
  const [statusFilter, setStatusFilter] = useState<string>("pending");

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  function handleUpdate(id: string, newStatus: string) {
    setProposals((prev) =>
      prev.map((item) =>
        item.proposal.id === id
          ? {
              ...item,
              proposal: { ...item.proposal, status: newStatus as WriteProposal["status"] },
            }
          : item
      )
    );
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleBatchApprove() {
    setBatchLoading(true);
    setBatchMessage(null);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    for (const id of ids) {
      const result = await approveProposalAction(id);
      if (result.success) {
        const data = result.data as { outcome: string };
        handleUpdate(id, data.outcome === "approved" ? "approved" : "conflicted");
        successCount++;
      }
    }
    setSelectedIds(new Set());
    setBatchLoading(false);
    setBatchMessage(`${successCount} of ${ids.length} approved`);
    setTimeout(() => setBatchMessage(null), 3000);
  }

  async function handleBatchReject() {
    setBatchLoading(true);
    setBatchMessage(null);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    for (const id of ids) {
      const result = await rejectProposalAction(id);
      if (result.success) {
        handleUpdate(id, "rejected");
        successCount++;
      }
    }
    setSelectedIds(new Set());
    setBatchLoading(false);
    setBatchMessage(`${successCount} of ${ids.length} rejected`);
    setTimeout(() => setBatchMessage(null), 3000);
  }

  const filtered =
    statusFilter === "all"
      ? proposals
      : proposals.filter((item) => item.proposal.status === statusFilter);

  const pendingCount = proposals.filter(
    (item) => item.proposal.status === "pending"
  ).length;

  const selectedCount = selectedIds.size;

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Write proposals</h2>
          <p className="text-sm text-muted-foreground">
            Machine-proposed changes waiting for your review.
          </p>
        </div>
        {pendingCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            {pendingCount} pending
          </Badge>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-fast",
              statusFilter === s
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Proposal list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <CircleDashed className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">
            {statusFilter === "pending"
              ? "No pending proposals"
              : `No ${statusFilter} proposals`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            {statusFilter === "pending"
              ? "Machine write proposals will appear here when connections submit them."
              : "Filter by a different status to see other proposals."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) =>
            item.proposal.target_object_type != null ? (
              <HeterogeneousProposalCard
                key={item.proposal.id}
                proposal={item.proposal}
                connectionName={item.connection?.name}
                currentObjectName={item.current_object?.name}
                currentObjectSource={item.current_object?.source_content}
                currentObjectFormat={item.current_object?.canonical_format}
                targetIsReusable={item.current_object?.is_reusable ?? false}
                onApprove={async (proposalId, reviewNote) => {
                  const result = await approveProposalAction(proposalId, reviewNote);
                  if (result.success) {
                    const data = result.data as { outcome: string };
                    handleUpdate(proposalId, data.outcome === "approved" ? "approved" : "conflicted");
                    return { ok: true, outcome: data.outcome };
                  }
                  return { ok: false, error: result.error };
                }}
                onReject={async (proposalId, reviewNote) => {
                  const result = await rejectProposalAction(proposalId, reviewNote);
                  if (result.success) {
                    handleUpdate(proposalId, "rejected");
                    return { ok: true };
                  }
                  return { ok: false, error: result.error };
                }}
              />
            ) : (
              <ProposalCard
                key={item.proposal.id}
                item={item}
                onUpdate={handleUpdate}
                isSelected={selectedIds.has(item.proposal.id)}
                onToggleSelect={handleToggleSelect}
              />
            )
          )}
        </div>
      )}

      {/* Sticky batch action bar — shown when any proposal is selected */}
      {selectedCount > 0 && (
        <div
          className={cn(
            "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
            "flex items-center gap-3 rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur px-4 py-3",
            "min-w-[280px]"
          )}
          role="toolbar"
          aria-label="Batch actions"
        >
          <span className="text-sm font-medium text-foreground">
            {selectedCount} selected
          </span>

          <button
            type="button"
            disabled={batchLoading}
            onClick={() => void handleBatchApprove()}
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-emerald-500/40",
              "bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400",
              "hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            )}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Approve All
          </button>

          <button
            type="button"
            disabled={batchLoading}
            onClick={() => void handleBatchReject()}
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-border/60",
              "bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground",
              "hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-50"
            )}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Reject All
          </button>

          <button
            type="button"
            disabled={batchLoading}
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>

          {batchLoading && (
            <span className="text-xs text-muted-foreground">Processing…</span>
          )}
          {batchMessage && !batchLoading && (
            <span className="text-xs text-green-500">{batchMessage}</span>
          )}
        </div>
      )}
    </div>
  );
}
