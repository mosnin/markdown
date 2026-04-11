"use client";

import { useState, useTransition } from "react";
import { Check, X, Globe, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProposalTargetSummary } from "./proposal_target_summary";
import type { WriteProposal } from "@/server/domain/types/write_proposal";

/**
 * HeterogeneousProposalCard
 *
 * Proposal review card that works for Notes, Files, Skills, and Agents.
 * Extends the existing ProposalCard (notes-only) to cover the expanded object model.
 *
 * Key design decisions:
 *   - Shows ProposalTargetSummary so the reviewer always knows what type is targeted
 *   - For object proposals: shows current source vs proposed source (source-level only)
 *   - Does NOT fake structured diffs — shows raw source content comparison
 *   - Reusable shared object proposals show the broader impact notice
 *   - Connection name always visible
 *   - Approve / Reject with optional review note
 */

type ProposalStatus = "pending" | "approved" | "rejected" | "conflicted" | "canceled" | "expired";

interface HeterogeneousProposalCardProps {
  proposal: WriteProposal;
  connectionName?: string;
  /** Current note content (for note proposals). */
  currentNoteContent?: string | null;
  currentNoteTitle?: string | null;
  /** Current object source (for file/skill/agent proposals). */
  currentObjectName?: string | null;
  currentObjectSource?: string | null;
  currentObjectFormat?: string | null;
  /** Whether the target object is reusable (shows impact notice). */
  targetIsReusable?: boolean;
  onApprove?: (proposalId: string, reviewNote?: string) => Promise<{ ok: boolean; error?: string; outcome?: string }>;
  onReject?: (proposalId: string, reviewNote?: string) => Promise<{ ok: boolean; error?: string }>;
}

const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  approved: { label: "Approved", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  rejected: { label: "Rejected", className: "bg-muted/40 text-muted-foreground border-border/60" },
  conflicted: { label: "Conflicted", className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/40" },
  canceled: { label: "Canceled", className: "bg-muted/40 text-muted-foreground border-border/60" },
  expired: { label: "Expired", className: "bg-muted/40 text-muted-foreground border-border/60" },
};

function ContentBlock({
  label,
  content,
  format,
  variant = "neutral",
}: {
  label: string;
  content: string | null | undefined;
  format?: string | null;
  variant?: "neutral" | "proposed" | "current" | "destructive";
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = content?.slice(0, 400) ?? "";
  const hasMore = (content?.length ?? 0) > 400;

  const variantClass: Record<string, string> = {
    neutral: "border-border/50 bg-muted/20",
    proposed: "border-blue-500/30 bg-blue-500/5",
    current: "border-border/40 bg-muted/30",
    destructive: "border-destructive/30 bg-destructive/5",
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {format && (
          <span className="rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {format}
          </span>
        )}
      </div>
      <div className={cn("rounded-md border px-3 py-2", variantClass[variant])}>
        <pre className="whitespace-pre-wrap font-mono text-[11px] text-foreground leading-relaxed">
          {expanded ? content : preview}
          {hasMore && !expanded && "…"}
        </pre>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <><ChevronUp className="h-3 w-3" aria-hidden="true" /> Show less</>
            ) : (
              <><ChevronDown className="h-3 w-3" aria-hidden="true" /> Show more</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function HeterogeneousProposalCard({
  proposal,
  connectionName,
  currentNoteContent,
  currentNoteTitle,
  currentObjectName,
  currentObjectSource,
  currentObjectFormat,
  targetIsReusable = false,
  onApprove,
  onReject,
}: HeterogeneousProposalCardProps) {
  const [isPending, startTransition] = useTransition();
  const [reviewNote, setReviewNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const status = proposal.status as ProposalStatus;
  const statusConfig = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const isPendingStatus = status === "pending";

  const isNoteProposal = proposal.target_note_id != null ||
    ["create_note", "update_note", "append_note", "replace_note"].includes(proposal.proposal_type);

  const isObjectProposal = proposal.target_object_type != null;

  function handleApprove() {
    if (!onApprove) return;
    setError(null);
    startTransition(async () => {
      const result = await onApprove(proposal.id, reviewNote || undefined);
      if (!result.ok) {
        setError(result.error ?? "Approval failed");
      } else if (result.outcome === "conflicted") {
        setOutcome("conflicted");
      }
    });
  }

  function handleReject() {
    if (!onReject) return;
    setError(null);
    startTransition(async () => {
      const result = await onReject(proposal.id, reviewNote || undefined);
      if (!result.ok) setError(result.error ?? "Rejection failed");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <ProposalTargetSummary
            proposalType={proposal.proposal_type as Parameters<typeof ProposalTargetSummary>[0]["proposalType"]}
            targetName={
              isNoteProposal
                ? (currentNoteTitle ?? proposal.proposed_title)
                : currentObjectName
            }
            canonicalFormat={currentObjectFormat}
            isReusable={targetIsReusable}
          />

          {connectionName && (
            <span className="text-xs text-muted-foreground">
              From <span className="font-medium text-foreground">{connectionName}</span>
            </span>
          )}
        </div>

        <span
          className={cn(
            "shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium",
            statusConfig.className
          )}
          aria-label={`Status: ${statusConfig.label}`}
        >
          {statusConfig.label}
        </span>
      </div>

      {/* Conflict notice */}
      {status === "conflicted" && (
        <div className="flex items-start gap-2 rounded border border-orange-500/30 bg-orange-500/8 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden="true" />
          <span className="text-muted-foreground">
            The target was modified after this proposal was submitted. Version conflict detected.
          </span>
        </div>
      )}

      {/* Reusable impact notice */}
      {targetIsReusable && isPendingStatus && (
        <div className="flex items-start gap-2 rounded border border-border/50 bg-muted/20 px-3 py-2 text-xs">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">
            This targets a workspace-shared {proposal.target_object_type}.
            Approving will affect all boxes that reference it.
          </span>
        </div>
      )}

      {/* Rationale */}
      {proposal.rationale && (
        <div className="rounded border border-border/40 bg-muted/20 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Rationale</p>
          <p className="text-xs text-muted-foreground">{proposal.rationale}</p>
        </div>
      )}

      {/* Content preview: note proposals */}
      {isNoteProposal && (
        <div className="flex flex-col gap-2">
          {["update_note", "append_note", "replace_note"].includes(proposal.proposal_type) && currentNoteContent && (
            <ContentBlock
              label="Current content"
              content={currentNoteContent}
              variant={proposal.proposal_type === "replace_note" ? "destructive" : "current"}
            />
          )}
          <ContentBlock
            label={
              proposal.proposal_type === "append_note"
                ? "Appending"
                : proposal.proposal_type === "create_note"
                ? "New content"
                : "Proposed content"
            }
            content={proposal.proposed_content}
            variant="proposed"
          />
        </div>
      )}

      {/* Content preview: object proposals */}
      {isObjectProposal && (
        <div className="flex flex-col gap-2">
          {currentObjectSource && (
            <ContentBlock
              label="Current source"
              content={currentObjectSource}
              format={currentObjectFormat ?? undefined}
              variant="current"
            />
          )}
          <ContentBlock
            label="Proposed source"
            content={proposal.proposed_content}
            format={currentObjectFormat ?? undefined}
            variant="proposed"
          />
        </div>
      )}

      {/* Post-approval outcome */}
      {outcome === "conflicted" && (
        <div className="flex items-start gap-2 rounded border border-orange-500/30 bg-orange-500/8 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden="true" />
          <span className="text-muted-foreground">
            Conflict detected during approval. The target was modified since submission.
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-destructive" role="alert">{error}</p>
      )}

      {/* Actions (only for pending proposals) */}
      {isPendingStatus && (onApprove || onReject) && (
        <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
          {showNote && (
            <textarea
              className={cn(
                "w-full resize-none rounded border border-border/50 bg-background px-3 py-2",
                "text-xs text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-1 focus:ring-ring"
              )}
              rows={2}
              placeholder="Optional review note..."
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              aria-label="Review note"
            />
          )}

          <div className="flex items-center gap-2">
            {onApprove && (
              <button
                type="button"
                disabled={isPending}
                onClick={handleApprove}
                className={cn(
                  "flex items-center gap-1.5 rounded border border-emerald-500/40",
                  "bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400",
                  "transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                )}
                aria-label="Approve proposal"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Approve
              </button>
            )}
            {onReject && (
              <button
                type="button"
                disabled={isPending}
                onClick={handleReject}
                className={cn(
                  "flex items-center gap-1.5 rounded border border-border/60",
                  "bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground",
                  "transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                )}
                aria-label="Reject proposal"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Reject
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowNote((s) => !s)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              aria-label="Toggle review note"
            >
              {showNote ? "Hide note" : "Add note"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
