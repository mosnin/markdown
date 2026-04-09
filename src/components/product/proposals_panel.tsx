"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock,
  FilePlus,
  FileText,
  RotateCcw,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { type WriteProposal } from "@/server/domain/types/write_proposal";
import { type Note } from "@/server/domain/types/note";
import { type Connection } from "@/server/domain/types/connection";
import {
  approveProposalAction,
  rejectProposalAction,
} from "@/app/app/proposals/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalWithContext {
  proposal: WriteProposal;
  connection: Connection | null;
  current_note: Note | null;
  preview_content: string | null;
}

interface ProposalsPanelProps {
  initialProposals: ProposalWithContext[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROPOSAL_TYPE_LABEL: Record<string, string> = {
  create_note: "Create note",
  update_note: "Update note",
  append_note: "Append to note",
  replace_note: "Replace note",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon: React.ElementType }
> = {
  pending:    { label: "Pending review", className: "bg-warning/15 text-warning border-warning/30",       icon: Clock },
  approved:   { label: "Approved",       className: "bg-success/15 text-success border-success/30",       icon: Check },
  rejected:   { label: "Rejected",       className: "bg-muted text-muted-foreground border-border",        icon: X },
  conflicted: { label: "Conflicted",     className: "bg-destructive/15 text-destructive border-destructive/30", icon: AlertTriangle },
  canceled:   { label: "Canceled",       className: "bg-muted text-muted-foreground border-border",        icon: XCircle },
  expired:    { label: "Expired",        className: "bg-muted text-muted-foreground border-border",        icon: Clock },
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, max = 200) {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

// ─── Status badge ─────────────────────────────────────────────────────────────

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

// ─── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const isReplace = type === "replace_note";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        isReplace
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground"
      )}
    >
      {isReplace && <AlertTriangle className="h-3 w-3" />}
      {PROPOSAL_TYPE_LABEL[type] ?? type}
    </span>
  );
}

// ─── Content preview ──────────────────────────────────────────────────────────

function ContentPreview({
  label,
  content,
  className,
}: {
  label: string;
  content: string | null;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!content) return null;
  const long = content.length > 300;
  const displayed = expanded || !long ? content : truncate(content, 300);

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-wrap font-mono">
        {displayed}
      </pre>
      {long && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ─── Single proposal card ─────────────────────────────────────────────────────

function ProposalCard({
  item,
  onUpdate,
}: {
  item: ProposalWithContext;
  onUpdate: (id: string, newStatus: string) => void;
}) {
  const { proposal, connection, current_note, preview_content } = item;
  const [reviewNote, setReviewNote] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isPendingProposal = proposal.status === "pending";
  const isConflicted = proposal.status === "conflicted";

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
        "border transition-colors",
        isConflicted && "border-destructive/40 bg-destructive/5"
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={proposal.proposal_type} />
              <StatusBadge status={proposal.status} />
            </div>

            {proposal.proposed_title && (
              <p className="text-sm font-medium truncate">
                {proposal.proposed_title}
              </p>
            )}
            {!proposal.proposed_title && current_note && (
              <p className="text-sm font-medium truncate text-muted-foreground">
                → {current_note.title}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
        {/* Rationale */}
        {proposal.rationale && (
          <div className="rounded-md bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground mb-0.5">
              Rationale
            </p>
            <p className="text-sm leading-relaxed">{proposal.rationale}</p>
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
        {proposal.proposal_type === "replace_note" && isPendingProposal && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-xs text-warning">
              This is a full replacement. Approving will overwrite the current note
              content entirely.
            </p>
          </div>
        )}

        {/* Details toggle */}
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
            {current_note && (
              <ContentPreview
                label="Current note"
                content={current_note.markdown_content}
              />
            )}
            <ContentPreview
              label={
                proposal.proposal_type === "append_note"
                  ? "Merged result (preview)"
                  : proposal.proposal_type === "create_note"
                  ? "Proposed content"
                  : "Proposed content"
              }
              content={preview_content}
              className={
                proposal.proposal_type === "append_note" ? "border-l-2 border-primary/40 pl-2" : undefined
              }
            />

            {proposal.proposed_tags && proposal.proposed_tags.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Proposed tags
                </p>
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

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

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

// ─── Proposals panel ──────────────────────────────────────────────────────────

export function ProposalsPanel({ initialProposals }: ProposalsPanelProps) {
  const [proposals, setProposals] =
    useState<ProposalWithContext[]>(initialProposals);
  const [statusFilter, setStatusFilter] = useState<string>("pending");

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

  const filtered =
    statusFilter === "all"
      ? proposals
      : proposals.filter((item) => item.proposal.status === statusFilter);

  const pendingCount = proposals.filter(
    (item) => item.proposal.status === "pending"
  ).length;

  return (
    <div className="space-y-4">
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
        {(["pending", "approved", "rejected", "conflicted", "all"] as const).map(
          (s) => (
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
          )
        )}
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
          {filtered.map((item) => (
            <ProposalCard
              key={item.proposal.id}
              item={item}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
