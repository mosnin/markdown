"use client";

import { createContext, useContext, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  File as FileIcon,
  Folder,
  GitMerge,
  Link2Off,
  Move,
  Zap,
  Bot,
  PackageOpen,
  Trash2,
  GitBranch,
  Check,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  promoteBranchAction,
  partialPromoteBranchAction,
  discardBranchAction,
  setActiveBranchAction,
  detectBranchConflictsAction,
  rebaseBranchAction,
  rollbackBranchPromotionAction,
  requestBranchReviewAction,
  submitBranchReviewAction,
  resetBranchReviewAction,
  createBranchCommentAction,
  resolveBranchCommentAction,
  unresolveBranchCommentAction,
  deleteBranchCommentAction,
  runPromotionGatesAction,
  listActivePromotionGatesAction,
} from "../actions";
import { dismissStaleWarningAction } from "@/app/app/settings/workspace/branch_retention/actions";
import type { DraftBranch } from "@/server/services/branch_service";
import type {
  BranchReviewWithReviewer,
} from "@/server/services/branch_review_service";
import type { BranchComment } from "@/server/services/branch_comment_service";
import type {
  BranchDiff,
  BranchDiffRow,
  CreatedAttachmentRow,
  CreatedNoteLinkRow,
  FolderOverrideDiffRow,
  PackageDiffGroup,
  PackageMetadataChange,
  PendingOpDiffRow,
  PlacementChangeRow,
} from "@/server/services/branch_diff_service";
import type { BranchConflict } from "@/server/services/branch_conflict_service";
import type { RebaseStrategy } from "@/server/services/branch_rebase_service";
import { useBranchPresence } from "@/lib/hooks/use_branch_presence";
import { BranchPresenceAvatars } from "@/components/product/branch_presence_avatars";
import { ProseDiff, DiffViewToggle } from "@/components/product/prose_diff";
import type { DiffViewMode } from "@/components/product/prose_diff";

/**
 * Branch detail + diff preview.
 *
 * Primary trust surface for branch promotion. Each head renders in
 * an expandable card showing:
 *   - object type + name + byte delta
 *   - "Main moved ahead" warning when applicable
 *   - side-by-side content preview (main | branch)
 *   - "Open in editor" link (which routes through the active branch
 *     cookie, so the editor opens branch content automatically)
 *
 * Promote / discard / switch-active buttons live in the sticky action
 * bar above the head list. Role gating is enforced on the server;
 * viewers see the page but don't see the write controls.
 */

/**
 * Context plumbing for the per-diff-row comment threads. The
 * `BranchDetailClient` root loads all comments once and groups them
 * by `(objectType, objectId)`; child cards pull their slice through
 * this context so nothing has to be prop-drilled five levels deep.
 */
interface CommentsCtxValue {
  branchId: string;
  currentUserId: string;
  /** Keyed by `${objectType}:${objectId}` — all comments for that thread. */
  byKey: Map<string, BranchComment[]>;
}
const CommentsContext = createContext<CommentsCtxValue | null>(null);

function useComments(): CommentsCtxValue | null {
  return useContext(CommentsContext);
}

function commentKey(objectType: string, objectId: string): string {
  return `${objectType}:${objectId}`;
}

/**
 * Selection state for cherry-pick / partial promote. When non-null,
 * each card that represents a promote-able object renders a checkbox
 * in its left gutter. Selection keys use the same
 * `${objectType}:${objectId}` shape as the server-side cherry-pick
 * filter so the wire format is 1:1.
 *
 * Only rendered when the branch is still `open` and the user has
 * write access. Otherwise the context is null and `SelectionCheckbox`
 * renders nothing.
 */
interface SelectionCtxValue {
  selected: Set<string>;
  toggle: (objectType: string, objectId: string) => void;
  /** `null` when the context isn't available (branch closed / viewer). */
}
const SelectionContext = createContext<SelectionCtxValue | null>(null);
function useSelection(): SelectionCtxValue | null {
  return useContext(SelectionContext);
}
function selectionKey(objectType: string, objectId: string): string {
  return `${objectType}:${objectId}`;
}

/**
 * Checkbox rendered in the left gutter of a promote-able card.
 * Noop when selection context is absent (closed branch or viewer
 * role). Stopping propagation on the onChange event prevents the
 * click from also toggling the expandable parent card.
 */
function SelectionCheckbox({
  objectType,
  objectId,
  label,
}: {
  objectType: string;
  objectId: string;
  label?: string;
}) {
  const sel = useSelection();
  if (!sel) return null;
  const key = selectionKey(objectType, objectId);
  const checked = sel.selected.has(key);
  return (
    <label
      className="flex shrink-0 items-center"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          e.stopPropagation();
          sel.toggle(objectType, objectId);
        }}
        aria-label={label ?? `Select ${objectType} for partial promote`}
        className="h-3.5 w-3.5 cursor-pointer accent-primary"
      />
    </label>
  );
}

const typeMeta: Record<
  BranchDiffRow["objectType"],
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  note: { label: "Note", Icon: FileText },
  file: { label: "File", Icon: FileIcon },
  skill: { label: "Skill", Icon: Zap },
  agent: { label: "Agent", Icon: Bot },
};

export function BranchDetailClient({
  branch,
  diff,
  canWrite,
  isActive,
  isAuthor,
  authoredByClientName,
  reviews,
  comments,
  currentUserId,
  currentUserEmail,
  retentionPolicy,
}: {
  branch: DraftBranch;
  diff: BranchDiff;
  canWrite: boolean;
  isActive: boolean;
  isAuthor: boolean;
  authoredByClientName?: string | null;
  reviews: BranchReviewWithReviewer[];
  comments: BranchComment[];
  currentUserId: string;
  /** Current viewer's email. Only used to compute a human-readable
   * display name for the realtime presence roster (email-prefix
   * fallback). Safe to leave null. */
  currentUserEmail?: string | null;
  /**
   * Workspace retention policy (Feature #8). Optional — when
   * undefined or `enabled=false` the stale banner never renders.
   */
  retentionPolicy?: {
    enabled: boolean;
    warn_after_idle_days: number;
    auto_discard_after_days: number;
  };
}) {
  const [confirmAction, setConfirmAction] = useState<"promote" | "discard" | "rollback" | "partial_promote" | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [conflicts, setConflicts] = useState<BranchConflict[] | null>(null);
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  const [rebaseConfirmOpen, setRebaseConfirmOpen] = useState(false);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [prePromoteConflicts, setPrePromoteConflicts] = useState<BranchConflict[] | null>(null);
  // Pre-promote webhook gates: minimal state for the panel below the
  // promote confirmation dialog. See docs/branch_promotion_gates_v1.md.
  const [gatesPanelOpen, setGatesPanelOpen] = useState(false);
  const [activeGatesCount, setActiveGatesCount] = useState<number | null>(null);
  const [gateRunResults, setGateRunResults] = useState<
    Array<{
      gate_id: string;
      gate_name: string;
      webhook_url: string;
      status: "pending" | "passed" | "failed" | "error" | "timeout";
      response_body: string | null;
    }>
  | null
  >(null);
  // Cherry-pick selection state. Keyed by `${objectType}:${objectId}`.
  // Lives in component state only — no persistence / URL sync.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const closed = branch.status !== "open";
  const conflictCount = diff.rows.filter((r) => r.mainMovedAhead).length;

  // Realtime branch presence roster. Empty array until the channel
  // subscribes and the first `sync` event arrives. The hook cleanly
  // untracks + removes the channel on unmount, so navigating away
  // (back button, link click, closing the tab) immediately drops us
  // from every other viewer's roster instead of waiting for the
  // heartbeat timeout.
  const presenceDisplayName =
    currentUserEmail && currentUserEmail.includes("@")
      ? currentUserEmail.split("@")[0]
      : currentUserEmail ?? currentUserId;
  const presentUsers = useBranchPresence(branch.id, {
    user_id: currentUserId,
    display_name: presenceDisplayName,
  });

  // Promote gating — mirror the server-side gate so the button is
  // disabled *before* the user clicks it. The action itself also
  // enforces this; the local check is a UX affordance.
  const unresolvedCommentCount = comments.filter((c) => !c.resolved).length;
  const reviewGateBlocks =
    branch.review_status === "review_requested" ||
    branch.review_status === "changes_requested";
  const commentGateBlocks = unresolvedCommentCount > 0;
  const promoteGateMessage = reviewGateBlocks
    ? branch.review_status === "review_requested"
      ? "Waiting for an approving review before promote."
      : "Reviewer requested changes. Address them and re-request review."
    : commentGateBlocks
    ? `Resolve ${unresolvedCommentCount} comment thread${unresolvedCommentCount === 1 ? "" : "s"} before promoting.`
    : null;

  // Fetch active gate count once on mount so the promote button can
  // route through the gates panel when the workspace has any gates
  // configured. No gates → skip the panel entirely.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listActivePromotionGatesAction();
      if (!cancelled && res.ok) setActiveGatesCount(res.data.length);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function runGates() {
    startTransition(async () => {
      const res = await runPromotionGatesAction(branch.id);
      if (res.ok) setGateRunResults(res.data.runs);
      else setToast({ kind: "err", text: res.error });
    });
  }

  function run(kind: "promote" | "discard") {
    startTransition(async () => {
      if (kind === "promote") {
        const res = await promoteBranchAction(branch.id);
        setConfirmAction(null);
        setPrePromoteConflicts(null);
        if (res.ok) {
          setToast({
            kind: "ok",
            text: `Promoted ${res.data.promotedObjects.length} object${res.data.promotedObjects.length === 1 ? "" : "s"} to main.`,
          });
          // Send user back to the list since this branch is now
          // promoted and this detail view will just read as "closed".
          window.location.href = "/app/branches";
        } else {
          setToast({ kind: "err", text: res.error });
        }
      } else {
        const res = await discardBranchAction(branch.id);
        setConfirmAction(null);
        if (res.ok) {
          setToast({ kind: "ok", text: "Branch discarded." });
          window.location.href = "/app/branches";
        } else {
          setToast({ kind: "err", text: res.error });
        }
      }
    });
  }

  function handlePromoteClick() {
    // If the workspace has active gates, surface the gates panel
    // first so the user can run + review them before the final
    // confirmation dialog. Conflict check still runs from inside the
    // gates panel's "Proceed" button.
    if ((activeGatesCount ?? 0) > 0) {
      setGatesPanelOpen(true);
      return;
    }
    if (conflictCount === 0) { setConfirmAction("promote"); return; }
    startTransition(async () => {
      const res = await detectBranchConflictsAction(branch.id);
      if (res.ok && res.data.length > 0) setPrePromoteConflicts(res.data);
      else setConfirmAction("promote");
    });
  }
  function handleResolveConflicts() {
    startTransition(async () => {
      const res = await detectBranchConflictsAction(branch.id);
      if (res.ok) { setConflicts(res.data); setConflictPanelOpen(true); setConflictDismissed(false); setPrePromoteConflicts(null); }
      else setToast({ kind: "err", text: res.error });
    });
  }
  function handleRebase(strategy: RebaseStrategy) {
    startTransition(async () => {
      const res = await rebaseBranchAction(branch.id, strategy);
      setRebaseConfirmOpen(false); setConflictPanelOpen(false); setPrePromoteConflicts(null);
      if (res.ok) { setToast({ kind: "ok", text: `Rebased ${res.data.rebased} object${res.data.rebased === 1 ? "" : "s"}.` }); setConflicts(null); setConflictDismissed(false); window.location.reload(); }
      else setToast({ kind: "err", text: res.error });
    });
  }
  async function switchActive() {
    const res = await setActiveBranchAction(isActive ? null : branch.id);
    if (res.ok) window.location.reload();
    else setToast({ kind: "err", text: res.error });
  }

  // Group comments by their (objectType, objectId) thread key.
  // Memoized so HeadCards don't re-group on every render.
  const commentsByKey = useMemo(() => {
    const m = new Map<string, BranchComment[]>();
    for (const c of comments) {
      const k = commentKey(c.object_type, c.object_id);
      const arr = m.get(k) ?? [];
      arr.push(c);
      m.set(k, arr);
    }
    return m;
  }, [comments]);

  const commentsCtx: CommentsCtxValue = useMemo(
    () => ({ branchId: branch.id, currentUserId, byKey: commentsByKey }),
    [branch.id, currentUserId, commentsByKey]
  );

  // Universe of selectable (objectType, objectId) keys — the set
  // "Select all" would check. Each kind of diff row maps to one
  // selection identity.
  //   - Packages (skill / agent) are selectable as the package itself
  //     — its children / metadata promote together.
  //   - Standalone heads select by (objectType, objectId).
  //   - Pending ops select by the op's target object.
  //   - Folder overrides, placement changes, note links, attachments,
  //     box metadata changes each have their own native key.
  // `changedKeys` additionally restricts to keys whose row has a
  // non-zero diff — the "Select changed only" mode skips rows that
  // the diff engine kept around but which don't actually differ.
  const allSelectableKeys = useMemo(() => {
    const s = new Set<string>();
    for (const p of diff.packages) s.add(selectionKey(p.packageType, p.packageId));
    for (const r of diff.standalone) s.add(selectionKey(r.objectType, r.objectId));
    for (const op of diff.pendingOps) s.add(selectionKey(op.objectType, op.objectId));
    for (const f of diff.folderOverrides) s.add(selectionKey("folder", f.folderId));
    for (const pc of diff.placementChanges) {
      if (pc.targetType === "box_object_attachment") {
        s.add(selectionKey("box_object_attachment", pc.targetId));
      } else if (pc.objectType && pc.objectId) {
        s.add(selectionKey(pc.objectType, pc.objectId));
      }
    }
    for (const nl of diff.createdNoteLinks) s.add(selectionKey("note_link", nl.id));
    for (const att of diff.createdAttachments) s.add(selectionKey("box_object_attachment", att.id));
    for (const bm of diff.boxMetadataChanges) s.add(selectionKey("box", bm.boxId));
    return s;
  }, [diff]);

  // "Select changed only" universe — today the diff service only
  // emits rows whose overlay actually differs from main, so it
  // matches `allSelectableKeys`. Kept as a separate computation so a
  // future refinement (e.g. filtering out empty metadata overlays)
  // stays a one-line change.
  const changedKeys = allSelectableKeys;

  // Selection-key → display-name map, used by the partial-promote
  // confirmation dialog to list the selected objects by name.
  const displayNameByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of diff.packages) {
      m.set(selectionKey(p.packageType, p.packageId), p.packageName);
    }
    for (const r of diff.standalone) {
      m.set(selectionKey(r.objectType, r.objectId), r.displayName);
    }
    for (const op of diff.pendingOps) {
      // Don't overwrite a standalone head entry that may have a nicer name.
      const k = selectionKey(op.objectType, op.objectId);
      if (!m.has(k)) m.set(k, op.displayName);
    }
    for (const f of diff.folderOverrides) {
      m.set(selectionKey("folder", f.folderId), f.folderName);
    }
    for (const pc of diff.placementChanges) {
      const k =
        pc.targetType === "box_object_attachment"
          ? selectionKey("box_object_attachment", pc.targetId)
          : pc.objectType && pc.objectId
          ? selectionKey(pc.objectType, pc.objectId)
          : null;
      if (k && !m.has(k)) m.set(k, pc.displayName);
    }
    for (const nl of diff.createdNoteLinks) {
      m.set(
        selectionKey("note_link", nl.id),
        `${nl.sourceTitle ?? "(note)"} → ${nl.targetTitle ?? "(note)"}`
      );
    }
    for (const att of diff.createdAttachments) {
      m.set(
        selectionKey("box_object_attachment", att.id),
        `${att.objectName ?? att.objectType} → ${att.boxName ?? "(box)"}`
      );
    }
    for (const bm of diff.boxMetadataChanges) {
      const k = selectionKey("box", bm.boxId);
      if (!m.has(k)) m.set(k, bm.boxName);
    }
    return m;
  }, [diff]);

  const selectionCtx: SelectionCtxValue | null = canWrite && branch.status === "open"
    ? {
        selected,
        toggle: (objectType, objectId) => {
          const k = selectionKey(objectType, objectId);
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
          });
        },
      }
    : null;

  function selectAll() {
    setSelected(new Set(allSelectableKeys));
  }
  function selectNone() {
    setSelected(new Set());
  }
  function selectChangedOnly() {
    setSelected(new Set(changedKeys));
  }

  function runPartialPromote() {
    const payload = Array.from(selected).map((k) => {
      const idx = k.indexOf(":");
      return { objectType: k.slice(0, idx), objectId: k.slice(idx + 1) };
    });
    startTransition(async () => {
      const res = await partialPromoteBranchAction(branch.id, payload);
      setConfirmAction(null);
      if (res.ok) {
        const remaining = res.data.branchStatus === "promoted" ? 0 : -1;
        setToast({
          kind: "ok",
          text:
            res.data.branchStatus === "promoted"
              ? `Promoted ${res.data.promotedObjects.length} object${res.data.promotedObjects.length === 1 ? "" : "s"}. Branch fully promoted.`
              : `Promoted ${res.data.promotedObjects.length} object${res.data.promotedObjects.length === 1 ? "" : "s"}. Branch stays open with remaining work.`,
        });
        void remaining;
        // Partial promote that covered everything → back to list;
        // otherwise reload the detail page so the remaining diff
        // reflects what's left.
        if (res.data.branchStatus === "promoted") {
          window.location.href = "/app/branches";
        } else {
          setSelected(new Set());
          window.location.reload();
        }
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <CommentsContext.Provider value={commentsCtx}>
    <SelectionContext.Provider value={selectionCtx}>
    <div className="space-y-5">
      {toast && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
            toast.kind === "ok"
              ? "border-border bg-card"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          )}
          role={toast.kind === "ok" ? "status" : "alert"}
        >
          {toast.kind === "err" && (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <p className="flex-1">{toast.text}</p>
        </div>
      )}

      {/* Meta + action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3 text-sm">
          <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">{branch.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {diff.headCount} head{diff.headCount === 1 ? "" : "s"}
              {diff.totalBytesAdded > 0 && (
                <> · <span className="text-emerald-600">+{diff.totalBytesAdded} bytes</span></>
              )}
              {diff.totalBytesRemoved > 0 && (
                <> · <span className="text-destructive">-{diff.totalBytesRemoved} bytes</span></>
              )}
            </p>
          </div>
          {closed && (
            <Badge variant="outline" className="capitalize text-[10px]">
              {branch.status}
            </Badge>
          )}
          {isActive && !closed && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Check className="h-3 w-3" aria-hidden="true" />
              active
            </Badge>
          )}
          {authoredByClientName && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Bot className="h-3 w-3" aria-hidden="true" />
              Authored by {authoredByClientName} via MCP
            </Badge>
          )}
          {presentUsers.length > 0 && (
            <BranchPresenceAvatars users={presentUsers} />
          )}
        </div>

        {canWrite && !closed && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={switchActive}
              disabled={pending}
            >
              {isActive ? "Switch to main" : "Switch to this branch"}
            </Button>
            <Button
              size="sm"
              onClick={handlePromoteClick}
              disabled={pending || Boolean(promoteGateMessage) || (diff.headCount === 0 && diff.pendingOps.length === 0 && diff.folderOverrides.length === 0 && diff.placementChanges.length === 0 && diff.createdNoteLinks.length === 0 && diff.createdAttachments.length === 0)}
              title={promoteGateMessage ?? ((diff.headCount === 0 && diff.pendingOps.length === 0 && diff.folderOverrides.length === 0 && diff.placementChanges.length === 0 && diff.createdNoteLinks.length === 0 && diff.createdAttachments.length === 0) ? "Nothing to promote" : undefined)}
            >
              <PackageOpen className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Promote all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmAction("partial_promote")}
              disabled={pending || Boolean(promoteGateMessage) || selected.size === 0}
              title={
                promoteGateMessage ??
                (selected.size === 0
                  ? "Check objects below to enable cherry-pick promote"
                  : `Promote ${selected.size} selected object${selected.size === 1 ? "" : "s"} and leave the rest on the branch`)
              }
            >
              <PackageOpen className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Promote selected ({selected.size})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction("discard")}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      {/* Review status banner */}
      {!closed && branch.review_status !== "draft" && (
        <ReviewStatusBanner status={branch.review_status} />
      )}

      {/* Review actions + review list panel */}
      {!closed && (
        <ReviewPanel
          branchId={branch.id}
          reviewStatus={branch.review_status}
          isAuthor={isAuthor}
          canWrite={canWrite}
          reviews={reviews}
          currentUserId={currentUserId}
          setToast={setToast}
        />
      )}

      {/* Conflict banner */}
      {conflictCount > 0 && !closed && canWrite && !conflictDismissed && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <span className="font-medium text-warning">{conflictCount} conflict{conflictCount === 1 ? "" : "s"} detected</span>
              <span className="text-xs text-muted-foreground">— main has changed since you branched</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleResolveConflicts} disabled={pending}>Resolve conflicts</Button>
              <Button variant="outline" size="sm" onClick={() => setRebaseConfirmOpen(true)} disabled={pending}>
                <GitMerge className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Rebase on latest main
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConflictDismissed(true)} disabled={pending} className="text-xs text-muted-foreground" title="Dismiss this warning. Promoting will overwrite main's newer changes.">Keep my branch as-is</Button>
            </div>
          </div>
        </div>
      )}
      {/* Conflict resolution panel */}
      {conflictPanelOpen && conflicts && conflicts.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-card px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Conflict resolution — {conflicts.length} object{conflicts.length === 1 ? "" : "s"}</h2>
            <Button variant="ghost" size="sm" onClick={() => setConflictPanelOpen(false)} className="text-xs text-muted-foreground">Close</Button>
          </div>
          <ul className="flex flex-col gap-3 list-none">
            {conflicts.map((c) => (
              <li key={`${c.objectType}:${c.objectId}`}><ConflictCard conflict={c} /></li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button size="sm" onClick={() => handleRebase("keep_main")} disabled={pending} variant="outline">Keep all from main</Button>
            <Button size="sm" onClick={() => handleRebase("keep_branch")} disabled={pending} variant="outline">Keep all from branch</Button>
            <Button size="sm" onClick={() => handleRebase("rebase_branch_on_main")} disabled={pending}>
              <GitMerge className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Rebase all on main
            </Button>
          </div>
        </div>
      )}

      {/* Stale-warning banner (Feature #8). Renders when the branch
          is open, has been warned within the last 7 days, and the
          workspace retention policy is enabled. Two actions: "Keep
          active" touches activity and clears the warning; "Discard
          now" triggers the canonical discard flow via the existing
          confirm dialog. Additive only — the surrounding banner stack
          is intentionally left as-is. */}
      {(() => {
        if (!retentionPolicy?.enabled) return null;
        if (branch.status !== "open") return null;
        if (!branch.last_warned_at) return null;
        const warnedMs = new Date(branch.last_warned_at).getTime();
        const WARN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(warnedMs) || Date.now() - warnedMs > WARN_WINDOW_MS) return null;
        const activityISO = branch.last_activity_at ?? branch.created_at;
        const idleDays = Math.floor(
          (Date.now() - new Date(activityISO).getTime()) / (24 * 60 * 60 * 1000)
        );
        const daysUntilDiscard = Math.max(
          0,
          retentionPolicy.auto_discard_after_days - idleDays
        );
        return (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-medium text-warning">
                  This branch has been idle for {idleDays} day{idleDays === 1 ? "" : "s"}.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  It will auto-discard in {daysUntilDiscard} day{daysUntilDiscard === 1 ? "" : "s"} if no activity.
                </p>
              </div>
            </div>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const res = await dismissStaleWarningAction(branch.id);
                      if (res.ok) {
                        setToast({ kind: "ok", text: "Branch marked active. Warning cleared." });
                        window.location.reload();
                      } else {
                        setToast({ kind: "err", text: res.error });
                      }
                    });
                  }}
                >
                  Keep active
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirmAction("discard")}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Discard now
                </Button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Promoted / rolled-back status banners.
          The state machine guarantees these statuses are mutually
          exclusive (a branch is in exactly one of open / promoting /
          promoted / rolled_back / discarded). We check each
          independently rather than an if/else chain: if the database
          were ever corrupted into an invalid state, we'd rather show
          both banners as informational output than silently hide one.
          Under normal operation at most one of these renders. */}
      {branch.status === "promoted" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <span className="text-foreground">
              This branch was promoted
              {branch.promoted_at && (
                <> on {new Date(branch.promoted_at).toLocaleDateString()}</>
              )}
            </span>
          </div>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction("rollback")}
              disabled={pending}
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Revert this promotion
            </Button>
          )}
        </div>
      )}

      {branch.status === "rolled_back" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-start gap-2 text-sm">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-0.5">
              <p className="text-foreground">
                This branch&apos;s promotion was reverted
                {branch.rolled_back_at && (
                  <> on {new Date(branch.rolled_back_at).toLocaleDateString()}</>
                )}
              </p>
              {canWrite && (
                <p className="text-[11px] text-muted-foreground">
                  Rebase re-anchors your branch on the latest main state
                  so you can edit and re-promote.
                </p>
              )}
            </div>
          </div>
          {canWrite && (
            <Button
              size="sm"
              onClick={() => handleRebase("rebase_branch_on_main")}
              disabled={pending}
            >
              <GitMerge className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              {pending ? "Rebasing…" : "Rebase to re-open this branch"}
            </Button>
          )}
        </div>
      )}

      {/* Cherry-pick selection toolbar. Lives above the diff blocks.
          Only renders when the selection context exists (branch open
          + caller has write access). Viewers and readers of closed
          branches don't see the selection affordance. */}
      {selectionCtx && allSelectableKeys.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-[11px]">
          <span className="text-muted-foreground">
            Cherry-pick: {selected.size}/{allSelectableKeys.size} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={selectAll}
            disabled={pending}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={selectChangedOnly}
            disabled={pending}
            title="Select rows with an actual diff against main"
          >
            Select changed only
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={selectNone}
            disabled={pending || selected.size === 0}
          >
            Select none
          </Button>
        </div>
      )}

      {/* Head list. Rendered in two passes — packaged (Skills /
          Agents with canonical source + child files + metadata
          changes all grouped together) and then standalone. When a
          branch has only standalone rows the grouped block is
          skipped; when a branch has only package changes (e.g. a
          metadata-only edit) the standalone block is skipped. */}
      {diff.rows.length === 0 && diff.packages.length === 0 && diff.pendingOps.length === 0 && diff.folderOverrides.length === 0 && diff.placementChanges.length === 0 && diff.createdNoteLinks.length === 0 && diff.createdAttachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No edits yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Switch to this branch and edit any note, file, skill, or
            agent. Every save lands here as a head you can review before
            promoting.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {diff.packages.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Skill &amp; Agent packages
                <span className="ml-2 text-[10px] font-normal">{diff.packages.length}</span>
              </h2>
              <ul className="flex flex-col gap-2 list-none">
                {diff.packages.map((p) => (
                  <li key={`${p.packageType}:${p.packageId}`}>
                    <PackageGroupCard group={p} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.standalone.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Other changes
                <span className="ml-2 text-[10px] font-normal">{diff.standalone.length}</span>
              </h2>
              <ul className="flex flex-col gap-2 list-none">
                {diff.standalone.map((row) => (
                  <li key={row.branchHeadId}>
                    <HeadCard row={row} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.pendingOps.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pending structural ops
                <span className="ml-2 text-[10px] font-normal">{diff.pendingOps.length}</span>
              </h2>
              <ul className="flex flex-col gap-1 list-none">
                {diff.pendingOps.map((op) => (
                  <li key={op.id}>
                    <PendingOpRow op={op} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.folderOverrides.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Folder changes
                <span className="ml-2 text-[10px] font-normal">{diff.folderOverrides.length}</span>
              </h2>
              <ul className="flex flex-col gap-2 list-none">
                {diff.folderOverrides.map((row) => (
                  <li key={row.folderId}>
                    <FolderOverrideCard row={row} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.placementChanges.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Placement changes
                <span className="ml-2 text-[10px] font-normal">{diff.placementChanges.length}</span>
              </h2>
              <ul className="flex flex-col gap-2 list-none">
                {diff.placementChanges.map((row) => (
                  <li key={`${row.targetType}:${row.targetId}`}>
                    <PlacementChangeCard row={row} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.createdNoteLinks.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                New note links
                <span className="ml-2 text-[10px] font-normal">{diff.createdNoteLinks.length}</span>
              </h2>
              <ul className="flex flex-col gap-1 list-none">
                {diff.createdNoteLinks.map((row) => (
                  <li key={row.id}>
                    <CreatedNoteLinkRowCard row={row} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.createdAttachments.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                New attachments
                <span className="ml-2 text-[10px] font-normal">{diff.createdAttachments.length}</span>
              </h2>
              <ul className="flex flex-col gap-1 list-none">
                {diff.createdAttachments.map((row) => (
                  <li key={row.id}>
                    <CreatedAttachmentRowCard row={row} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Pre-promote gates panel — branch promotion gates v1. Opens
          when the workspace has any active gates and the user clicks
          Promote. Renders a "Run gates" button + the latest pass/fail
          matrix. Only allows the user to proceed to the confirm
          dialog if every gate passed (admin-level skip is a separate
          server-action option). */}
      <Dialog open={gatesPanelOpen} onOpenChange={(v) => !v && setGatesPanelOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run promotion gates</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {activeGatesCount} gate{activeGatesCount === 1 ? "" : "s"} are configured for this workspace. Each must return a
            {" "}<code className="text-[11px]">pass</code> response before the branch can be promoted.
          </p>
          {gateRunResults && gateRunResults.length > 0 && (
            <ul className="flex flex-col gap-1 list-none">
              {gateRunResults.map((r) => (
                <li key={r.gate_id} className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px]",
                      r.status === "passed"
                        ? "border-emerald-600/40 text-emerald-700"
                        : "border-destructive/40 text-destructive"
                    )}
                  >
                    {r.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.gate_name}</p>
                    {r.response_body && (
                      <p className="truncate text-[10px] text-muted-foreground" title={r.response_body}>
                        {r.response_body.slice(0, 200)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setGatesPanelOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={runGates} disabled={pending}>
              {pending ? "Running…" : gateRunResults ? "Re-run gates" : "Run gates"}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setGatesPanelOpen(false);
                setGateRunResults(null);
                setConfirmAction("promote");
              }}
              disabled={pending || !gateRunResults || gateRunResults.some((r) => r.status !== "passed")}
            >
              Proceed to promote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialogs */}
      <Dialog
        open={confirmAction === "promote"}
        onOpenChange={(v) => !v && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote this branch?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This advances {diff.headCount} object{diff.headCount === 1 ? "" : "s"}
            {" "}on main to their branch-head state
            {diff.pendingOps.length > 0 && (
              <> and applies {diff.pendingOps.length} pending structural op{diff.pendingOps.length === 1 ? "" : "s"}</>
            )}
            {diff.folderOverrides.length > 0 && (
              <> and {diff.folderOverrides.length} folder change{diff.folderOverrides.length === 1 ? "" : "s"}</>
            )}
            {diff.placementChanges.length > 0 && (
              <> and {diff.placementChanges.length} placement change{diff.placementChanges.length === 1 ? "" : "s"}</>
            )}
            {diff.createdNoteLinks.length > 0 && (
              <> and {diff.createdNoteLinks.length} new note link{diff.createdNoteLinks.length === 1 ? "" : "s"}</>
            )}
            {diff.createdAttachments.length > 0 && (
              <> and {diff.createdAttachments.length} new attachment{diff.createdAttachments.length === 1 ? "" : "s"}</>
            )}
            {" "}as one grouped history entry. The promotion is itself a
            restore-able change set — you can undo it from History if
            something goes wrong.
          </p>
          {diff.rows.some((r) => r.mainMovedAhead) && (
            <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              Main has moved ahead for at least one of these objects
              since you started editing. Promoting will overwrite those
              newer main edits. Any overwritten work remains reachable
              via version history.
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => run("promote")} disabled={pending}>
              {pending ? "Promoting…" : "Promote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Partial-promote confirmation. Lists the selected objects by
          name so the user can verify the cherry-pick before it runs.
          After a successful call the branch may stay `open` if
          anything is left behind — messaging reflects that. */}
      <Dialog
        open={confirmAction === "partial_promote"}
        onOpenChange={(v) => !v && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Promote {selected.size} selected object{selected.size === 1 ? "" : "s"}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The selected objects will land on main as one grouped
            history entry. Any unselected heads, overlays, pending
            ops, or branch-local rows stay on this branch for a
            later promote or discard.
          </p>
          {selected.size > 0 && (
            <ul className="max-h-60 overflow-auto list-disc pl-5 text-xs text-foreground space-y-0.5">
              {Array.from(selected).slice(0, 200).map((k) => {
                const [type] = k.split(":");
                const name = displayNameByKey.get(k) ?? k;
                return (
                  <li key={k}>
                    <span className="font-medium">{name}</span>
                    <span className="ml-1 text-muted-foreground">({type})</span>
                  </li>
                );
              })}
              {selected.size > 200 && (
                <li className="text-muted-foreground italic">
                  …and {selected.size - 200} more.
                </li>
              )}
            </ul>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={runPartialPromote}
              disabled={pending || selected.size === 0}
            >
              {pending ? "Promoting…" : `Promote ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmAction === "discard"}
        onOpenChange={(v) => !v && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this branch?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The branch is marked discarded and disappears from the open
            list. The version rows written on the branch stay as
            permanent audit trail — nothing is deleted.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => run("discard")}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Discarding…" : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rebase confirmation dialog */}
      <Dialog open={rebaseConfirmOpen} onOpenChange={(v) => !v && setRebaseConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rebase on latest main?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will re-anchor your branch changes on top of the latest main versions. Your content stays; the version history is extended.
            {conflictCount > 0 && <> {conflictCount} object{conflictCount === 1 ? "" : "s"} will be rebased.</>}
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRebaseConfirmOpen(false)} disabled={pending}>Cancel</Button>
            <Button size="sm" onClick={() => handleRebase("rebase_branch_on_main")} disabled={pending}>{pending ? "Rebasing..." : "Rebase"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pre-promote conflict warning */}
      <Dialog open={prePromoteConflicts !== null} onOpenChange={(v) => !v && setPrePromoteConflicts(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Conflicts detected</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {prePromoteConflicts?.length ?? 0} object{(prePromoteConflicts?.length ?? 0) === 1 ? " has" : "s have"} been
            changed on main since you branched. Promoting will overwrite
            main&apos;s changes for those objects. Any overwritten work remains
            reachable via version history.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setPrePromoteConflicts(null); handleResolveConflicts(); }} disabled={pending}>Resolve first</Button>
            <Button size="sm" onClick={() => { setPrePromoteConflicts(null); setConfirmAction("promote"); }} disabled={pending}>Promote anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmAction === "rollback"}
        onOpenChange={(v) => !v && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert branch promotion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will undo all changes from this promotion, restoring the
            previous state. A rollback record will be created so this
            revert is also reversible.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                startTransition(async () => {
                  const res = await rollbackBranchPromotionAction(branch.id);
                  setConfirmAction(null);
                  if (res.ok) {
                    setToast({
                      kind: "ok",
                      text: `Promotion reverted. ${res.data.rolledBack} object${res.data.rolledBack === 1 ? "" : "s"} restored to their previous state.`,
                    });
                    window.location.reload();
                  } else {
                    setToast({ kind: "err", text: res.error });
                  }
                });
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Reverting…" : "Revert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </SelectionContext.Provider>
    </CommentsContext.Provider>
  );
}

function ConflictCard({ conflict }: { conflict: BranchConflict }) {
  const meta = typeMeta[conflict.objectType];
  const Icon = meta.Icon;
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-warning/30 bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="truncate text-sm font-medium flex-1">{conflict.displayName}</p>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal border-warning/40 text-warning">conflict</Badge>
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="grid grid-cols-1 gap-0 md:grid-cols-3 md:divide-x md:divide-border">
            <PreviewColumn heading="Base (fork point)" subheading={`version ${conflict.branchParentVersionId.slice(0, 8)}`} content={conflict.baseContent} bytes={conflict.baseContent?.length ?? 0} />
            <PreviewColumn heading="Main (current)" subheading={`version ${conflict.mainVersionId.slice(0, 8)}`} content={conflict.mainContent} bytes={conflict.mainContent?.length ?? 0} />
            <PreviewColumn heading="Branch (yours)" subheading={`version ${conflict.branchVersionId.slice(0, 8)}`} content={conflict.branchContent} bytes={conflict.branchContent?.length ?? 0} highlight />
          </div>
        </div>
      )}
    </div>
  );
}

function HeadCard({ row, selectable = true }: { row: BranchDiffRow; selectable?: boolean }) {
  const meta = typeMeta[row.objectType];
  const Icon = meta.Icon;
  const [open, setOpen] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffViewMode>("unified");
  const delta = row.branchBytes - row.mainBytes;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        {selectable && (
          <span className="mt-1">
            <SelectionCheckbox
              objectType={row.objectType}
              objectId={row.objectId}
              label={`Select ${row.displayName}`}
            />
          </span>
        )}
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{row.displayName}</p>
            {row.mainTrashed && (
              <Badge variant="outline" className="shrink-0 text-[10px] font-normal border-destructive/40 text-destructive">
                trashed on main
              </Badge>
            )}
            {row.mainMovedAhead && !row.mainTrashed && (
              <Badge variant="outline" className="shrink-0 text-[10px] font-normal border-warning/40 text-warning">
                main moved ahead
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {meta.label} · branch version #{row.branchVersionNumber}
            {delta !== 0 && (
              <>
                {" · "}
                {delta > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-emerald-600">
                    <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                    {delta} bytes
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-destructive">
                    <Minus className="h-2.5 w-2.5" aria-hidden="true" />
                    {Math.abs(delta)} bytes
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <Link
          href={row.href}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-fast"
        >
          Open editor
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Diff header with version info + view mode toggle */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <p className="text-[10px] text-muted-foreground">
              {row.mainVersionId ? `main ${row.mainVersionId.slice(0, 8)}` : "new on branch"}
              {" → "}
              {`branch ${row.branchVersionId.slice(0, 8)}`}
              {" · "}{row.mainBytes}b → {row.branchBytes}b
            </p>
            <DiffViewToggle mode={diffMode} onChange={setDiffMode} />
          </div>

          {/* Prose diff */}
          <div className="px-4 py-3">
            <ProseDiff
              before={row.mainContent}
              after={row.branchContent}
              mode={diffMode}
            />
          </div>
          <CommentThread objectType={row.objectType} objectId={row.objectId} />
        </div>
      )}
    </div>
  );
}

function PackageGroupCard({ group }: { group: PackageDiffGroup }) {
  const [open, setOpen] = useState(true);
  const Icon = group.packageType === "skill" ? Zap : Bot;
  const typeLabel = group.packageType === "skill" ? "Skill" : "Agent";

  const changeCount =
    (group.canonical ? 1 : 0) +
    group.children.length +
    group.metadataChanges.length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="mt-1">
          <SelectionCheckbox
            objectType={group.packageType}
            objectId={group.packageId}
            label={`Select ${group.packageName}`}
          />
        </span>
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{group.packageName}</p>
            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal capitalize">
              {typeLabel} package
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {changeCount} change{changeCount === 1 ? "" : "s"}
            {group.canonical && " · canonical source"}
            {group.children.length > 0 && ` · ${group.children.length} child file${group.children.length === 1 ? "" : "s"}`}
            {group.metadataChanges.length > 0 && ` · ${group.metadataChanges.length} metadata field${group.metadataChanges.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link
          href={group.packageHref}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-fast"
        >
          Open package
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {group.canonical && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Canonical source
              </p>
              {/* No checkbox on child rows — the package-level
                  checkbox governs everything under this group. */}
              <HeadCard row={group.canonical} selectable={false} />
            </div>
          )}
          {group.children.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Child files
              </p>
              <ul className="flex flex-col gap-2 list-none">
                {group.children.map((c) => (
                  <li key={c.branchHeadId}>
                    <HeadCard row={c} selectable={false} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {group.metadataChanges.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Metadata changes
              </p>
              <ul className="flex flex-col gap-1 list-none">
                {group.metadataChanges.map((c) => (
                  <li key={c.field}>
                    <MetadataChangeRow change={c} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * MetadataChangeRow — field-appropriate rendering for each known metadata field.
 *
 * Dispatch order:
 *   1. Null ↔ non-null: special "set for the first time" / "cleared" messages.
 *   2. "tags": tag-diff pills (unchanged / added / removed).
 *   3. Text fields (description, summary, system_prompt): stacked pre blocks.
 *   4. Enum-like scalars (agent_type, model_hint): side-by-side pill transition.
 *   5. Fallback: the original two-column code-block layout via formatMetaValue.
 */
function MetadataChangeRow({ change }: { change: PackageMetadataChange }) {
  const label = change.field.replace(/_/g, " ");

  // ── 1. Null handling ──────────────────────────────────────────────────────
  // When one side is null and the other isn't, skip the two-column split and
  // show a single descriptive message instead.
  if (change.mainValue === null && change.branchValue !== null) {
    return (
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background px-3 py-2 md:grid-cols-[auto_1fr]">
        <p className="text-[11px] font-semibold capitalize text-muted-foreground">{label}</p>
        <p className="text-xs italic text-muted-foreground">Set for the first time on this branch.</p>
      </div>
    );
  }
  if (change.mainValue !== null && change.branchValue === null) {
    return (
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background px-3 py-2 md:grid-cols-[auto_1fr]">
        <p className="text-[11px] font-semibold capitalize text-muted-foreground">{label}</p>
        <p className="text-xs italic text-muted-foreground">Cleared on this branch.</p>
      </div>
    );
  }

  // ── 2. Tags field ─────────────────────────────────────────────────────────
  // Computes three groups from the two arrays: unchanged, removed, added.
  // Renders each group as colour-coded pill badges.
  if (change.field === "tags") {
    const mainTags = Array.isArray(change.mainValue)
      ? (change.mainValue as unknown[]).map(String)
      : [];
    const branchTags = Array.isArray(change.branchValue)
      ? (change.branchValue as unknown[]).map(String)
      : [];
    const mainSet = new Set(mainTags);
    const branchSet = new Set(branchTags);
    const unchanged = mainTags.filter((t) => branchSet.has(t));
    const removed = mainTags.filter((t) => !branchSet.has(t));
    const added = branchTags.filter((t) => !mainSet.has(t));

    return (
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background px-3 py-2 md:grid-cols-[auto_1fr]">
        <p className="text-[11px] font-semibold capitalize text-muted-foreground">{label}</p>
        <div className="flex flex-wrap gap-1">
          {unchanged.map((tag) => (
            <Badge key={`u:${tag}`} variant="outline" className="text-[10px]">
              {tag}
            </Badge>
          ))}
          {removed.map((tag) => (
            <Badge
              key={`r:${tag}`}
              variant="outline"
              className="gap-0.5 border-destructive/40 bg-destructive/10 text-destructive text-[10px]"
            >
              <Minus className="h-2.5 w-2.5" aria-hidden="true" />
              {tag}
            </Badge>
          ))}
          {added.map((tag) => (
            <Badge
              key={`a:${tag}`}
              variant="outline"
              className="gap-0.5 border-success/40 bg-success/10 text-success text-[10px]"
            >
              <Plus className="h-2.5 w-2.5" aria-hidden="true" />
              {tag}
            </Badge>
          ))}
          {unchanged.length === 0 && removed.length === 0 && added.length === 0 && (
            <span className="text-xs italic text-muted-foreground">No tags.</span>
          )}
        </div>
      </div>
    );
  }

  // ── 3. Text fields ────────────────────────────────────────────────────────
  // description, summary, system_prompt — when both sides are strings, render
  // as stacked preformatted blocks truncated at ~240 chars so the card stays
  // compact. Full content is reachable via "Open editor" / "Open package".
  const TEXT_FIELDS = ["description", "summary", "system_prompt"];
  const TRUNCATE_LEN = 240;
  if (
    TEXT_FIELDS.includes(change.field) &&
    typeof change.mainValue === "string" &&
    typeof change.branchValue === "string"
  ) {
    const truncate = (s: string) =>
      s.length > TRUNCATE_LEN ? s.slice(0, TRUNCATE_LEN) + "…" : s;

    return (
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background px-3 py-2">
        <p className="text-[11px] font-semibold capitalize text-muted-foreground">{label}</p>
        {/* Main value: muted, visually "old" */}
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Main</p>
          <pre className="rounded bg-muted/50 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap break-words text-muted-foreground line-through decoration-muted-foreground/40">
            {truncate(change.mainValue)}
          </pre>
        </div>
        {/* Branch value: highlighted with the existing warning accent palette */}
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase text-warning">Branch</p>
          <pre className="rounded bg-warning/10 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap break-words">
            {truncate(change.branchValue)}
          </pre>
        </div>
      </div>
    );
  }

  // ── 4. Enum-like scalar fields ────────────────────────────────────────────
  // agent_type, model_hint — when both sides are non-null scalar strings,
  // show a "main pill → branch pill" transition so the change is immediately
  // legible at a glance without reading raw code blocks.
  const ENUM_FIELDS = ["agent_type", "model_hint"];
  if (
    ENUM_FIELDS.includes(change.field) &&
    typeof change.mainValue === "string" &&
    typeof change.branchValue === "string"
  ) {
    return (
      <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background px-3 py-2 md:grid-cols-[auto_1fr]">
        <p className="text-[11px] font-semibold capitalize text-muted-foreground">{label}</p>
        <div className="flex items-center gap-2">
          {/* Main: outline pill */}
          <Badge variant="outline" className="text-[11px] font-mono">
            {change.mainValue}
          </Badge>
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          {/* Branch: filled secondary pill */}
          <Badge variant="secondary" className="text-[11px] font-mono">
            {change.branchValue}
          </Badge>
        </div>
      </div>
    );
  }

  // ── 5. Generic fallback ───────────────────────────────────────────────────
  // Unknown or unrecognised field types fall back to the original two-column
  // code-block layout so we never silently swallow data.
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-background px-3 py-2 md:grid-cols-[auto_1fr_1fr]">
      <p className="text-[11px] font-semibold capitalize text-muted-foreground">
        {label}
      </p>
      <div className="text-xs">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Main</p>
        <code className="block rounded bg-muted/50 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap break-words">
          {formatMetaValue(change.mainValue)}
        </code>
      </div>
      <div className="text-xs">
        <p className="text-[10px] font-semibold uppercase text-warning">Branch</p>
        <code className="block rounded bg-warning/10 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap break-words">
          {formatMetaValue(change.branchValue)}
        </code>
      </div>
    </div>
  );
}

function formatMetaValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : v.join(", ");
  return String(v);
}

function PendingOpRow({ op }: { op: PendingOpDiffRow }) {
  // Icon + copy keyed off op_type. Trash uses destructive palette so
  // the "will delete on promote" intent is visible at a glance; other
  // ops use muted styling since they're non-destructive status
  // transitions or moves.
  const meta: Record<
    PendingOpDiffRow["opType"],
    {
      label: string;
      Icon: React.ComponentType<{ className?: string }>;
      tone: "muted" | "destructive" | "warning";
    }
  > = {
    trash: { label: "Trash", Icon: Trash2, tone: "destructive" },
    archive: { label: "Archive", Icon: Archive, tone: "muted" },
    unarchive: { label: "Unarchive", Icon: ArchiveRestore, tone: "muted" },
    move: { label: "Move", Icon: Move, tone: "warning" },
    detach: { label: "Detach", Icon: Link2Off, tone: "warning" },
  };
  const m = meta[op.opType];
  const objectTypeLabel: Record<PendingOpDiffRow["objectType"], string> = {
    note: "Note",
    file: "File",
    folder: "Folder",
    skill: "Skill",
    agent: "Agent",
    object_link: "Object link",
    box_object_attachment: "Box attachment",
    note_link: "Note link",
  };
  const ObjectIcon =
    op.objectType === "note"
      ? FileText
      : op.objectType === "file"
      ? FileIcon
      : op.objectType === "folder"
      ? Folder
      : op.objectType === "skill"
      ? Zap
      : op.objectType === "agent"
      ? Bot
      : Link2Off;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
      <SelectionCheckbox
        objectType={op.objectType}
        objectId={op.objectId}
        label={`Select pending op on ${op.displayName}`}
      />
      <Badge
        variant="outline"
        className={cn(
          "gap-1 text-[10px] font-normal",
          m.tone === "destructive" && "border-destructive/40 text-destructive",
          m.tone === "warning" && "border-warning/40 text-warning",
        )}
      >
        <m.Icon className="h-3 w-3" aria-hidden="true" />
        {m.label}
      </Badge>
      <ObjectIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{op.displayName}</p>
        <p className="text-[10px] text-muted-foreground">
          {objectTypeLabel[op.objectType]}
          {op.opType === "move" && hasMovePayload(op.payload) && (
            <> · {describeMovePayload(op.payload)}</>
          )}
        </p>
      </div>
      {op.href && (
        <Link
          href={op.href}
          className="shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-fast"
        >
          Open
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function hasMovePayload(p: Record<string, unknown>): boolean {
  return (
    p.box_id !== undefined ||
    p.folder_id !== undefined ||
    p.sort_order !== undefined ||
    p.path_cache !== undefined
  );
}

function describeMovePayload(p: Record<string, unknown>): string {
  // Compact, id-based summary. The branch detail page doesn't need a
  // fully-resolved pretty path — the user can open the object to see
  // where it's going. This keeps the diff cheap to render.
  const parts: string[] = [];
  if (typeof p.path_cache === "string") parts.push(`→ ${p.path_cache}`);
  if (typeof p.folder_id === "string") parts.push(`folder ${p.folder_id.slice(0, 8)}`);
  else if (p.folder_id === null) parts.push("to root");
  if (typeof p.box_id === "string") parts.push(`box ${p.box_id.slice(0, 8)}`);
  return parts.join(" · ");
}

/**
 * PlacementChangeCard — renders one drag-and-drop reorder/move
 * intent recorded against a main row. Uses the same field-level
 * `MetadataChangeRow` component as folder overrides + package
 * metadata so all three diff sections share visual shape. Only the
 * fields that actually changed (sort_order or folder_id) get a row.
 */
function PlacementChangeCard({ row }: { row: PlacementChangeRow }) {
  const fieldRows: { field: string; mainValue: unknown; branchValue: unknown }[] = [];
  if (row.before.sortOrder !== row.after.sortOrder) {
    fieldRows.push({
      field: "sort_order",
      mainValue: row.before.sortOrder,
      branchValue: row.after.sortOrder,
    });
  }
  if (row.before.folderId !== row.after.folderId) {
    fieldRows.push({
      field: "folder_id",
      mainValue: row.before.folderId,
      branchValue: row.after.folderId,
    });
  }
  // Placement-change selection key mirrors the server-side
  // cherry-pick rule: attachment overlays select as their own row;
  // workspace_object overlays select by the inner (objectType,
  // objectId). When inner identity is missing we just drop the
  // checkbox — those orphan overlays can't be cherry-picked safely.
  const selKey = row.targetType === "box_object_attachment"
    ? { type: "box_object_attachment" as const, id: row.targetId }
    : row.objectType && row.objectId
    ? { type: row.objectType, id: row.objectId }
    : null;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        {selKey && (
          <SelectionCheckbox
            objectType={selKey.type}
            objectId={selKey.id}
            label={`Select placement change for ${row.displayName}`}
          />
        )}
        <PackageOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="truncate text-sm font-medium">{row.displayName}</p>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {row.targetType === "box_object_attachment" ? "attachment" : (row.objectType ?? "object")}
        </Badge>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {fieldRows.length} field{fieldRows.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <ul className="flex flex-col gap-1 list-none">
        {fieldRows.map((c) => (
          <li key={c.field}>
            <MetadataChangeRow change={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreatedNoteLinkRowCard({ row }: { row: CreatedNoteLinkRow }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <SelectionCheckbox
          objectType="note_link"
          objectId={row.id}
          label={`Select note link ${row.sourceTitle ?? ""} → ${row.targetTitle ?? ""}`}
        />
        <Link
          href={row.sourceHref}
          className="truncate font-medium hover:underline"
        >
          {row.sourceTitle ?? "(missing note)"}
        </Link>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {row.relationshipType}
        </Badge>
        <Link
          href={row.targetHref}
          className="truncate font-medium hover:underline"
        >
          {row.targetTitle ?? "(missing note)"}
        </Link>
      </div>
      {row.relationshipNote && (
        <p className="mt-1 text-xs text-muted-foreground">{row.relationshipNote}</p>
      )}
    </div>
  );
}

function CreatedAttachmentRowCard({ row }: { row: CreatedAttachmentRow }) {
  const Icon = row.objectType === "skill" ? Zap : Bot;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <SelectionCheckbox
          objectType="box_object_attachment"
          objectId={row.id}
          label={`Select attachment ${row.objectName ?? row.objectType}`}
        />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Link
          href={row.objectHref}
          className="truncate font-medium hover:underline"
        >
          {row.objectName ?? `(missing ${row.objectType})`}
        </Link>
        <span className="text-muted-foreground">attached to</span>
        <Link
          href={row.boxHref}
          className="truncate font-medium hover:underline"
        >
          {row.boxName ?? "(missing box)"}
        </Link>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {row.objectType}
        </Badge>
      </div>
    </div>
  );
}

function FolderOverrideCard({ row }: { row: FolderOverrideDiffRow }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <SelectionCheckbox
          objectType="folder"
          objectId={row.folderId}
          label={`Select folder change ${row.folderName}`}
        />
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="truncate text-sm font-medium">{row.folderName}</p>
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {row.changes.length} field{row.changes.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <ul className="flex flex-col gap-1 list-none">
        {row.changes.map((c) => (
          <li key={c.field}>
            <MetadataChangeRow
              change={{
                field: c.field,
                mainValue: c.mainValue,
                branchValue: c.branchValue,
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewColumn({
  heading,
  subheading,
  content,
  bytes,
  highlight,
}: {
  heading: string;
  subheading: string;
  content: string | null;
  bytes: number;
  highlight?: boolean;
}) {
  return (
    <div className={cn("px-4 py-3", highlight && "bg-accent/20")}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {heading}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {subheading} · {bytes}b
        </p>
      </div>
      {content === null ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
          No content (object not present on main).
        </p>
      ) : content === "" ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
          Empty.
        </p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
    </div>
  );
}

// ─── Review banner ──────────────────────────────────────────────────────────

function ReviewStatusBanner({
  status,
}: {
  status: DraftBranch["review_status"];
}) {
  if (status === "review_requested") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="text-foreground">
          Review requested — waiting for approval
        </span>
      </div>
    );
  }
  if (status === "changes_requested") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="text-foreground">
          Changes requested by reviewer — please address and re-request review
        </span>
      </div>
    );
  }
  if (status === "approved") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/5 px-4 py-3 text-sm">
        <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <span className="text-foreground">Approved — ready to promote</span>
      </div>
    );
  }
  return null;
}

// ─── Review actions + list panel ────────────────────────────────────────────

function ReviewPanel({
  branchId,
  reviewStatus,
  isAuthor,
  canWrite,
  reviews,
  currentUserId,
  setToast,
}: {
  branchId: string;
  reviewStatus: DraftBranch["review_status"];
  isAuthor: boolean;
  canWrite: boolean;
  reviews: BranchReviewWithReviewer[];
  currentUserId: string;
  setToast: (t: { kind: "ok" | "err"; text: string }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  function requestReviewNow() {
    startTransition(async () => {
      const res = await requestBranchReviewAction(branchId);
      if (res.ok) {
        setToast({ kind: "ok", text: "Review requested." });
        window.location.reload();
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  function resetReviewNow() {
    startTransition(async () => {
      const res = await resetBranchReviewAction(branchId);
      if (res.ok) {
        setToast({ kind: "ok", text: "Review reset." });
        window.location.reload();
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  function submitDecision(decision: "approved" | "changes_requested") {
    startTransition(async () => {
      const res = await submitBranchReviewAction(
        branchId,
        decision,
        note.trim() || null
      );
      if (res.ok) {
        setNote("");
        setToast({
          kind: "ok",
          text:
            decision === "approved"
              ? "Approved."
              : "Changes requested.",
        });
        window.location.reload();
      } else {
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  const hasAnyReview = reviews.length > 0;
  // The "Reset after edits" button is shown to the author whenever
  // any review exists (to clear stale approvals) or whenever review
  // is in a non-draft state.
  const showResetButton =
    isAuthor && canWrite && (hasAnyReview || reviewStatus !== "draft");

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium text-foreground">Review</p>
          <p className="text-[11px] text-muted-foreground capitalize">
            Status: {reviewStatus.replace(/_/g, " ")}
          </p>
        </div>
        {isAuthor && canWrite && (
          <div className="flex flex-wrap gap-2">
            {reviewStatus === "draft" && (
              <Button
                variant="outline"
                size="sm"
                onClick={requestReviewNow}
                disabled={pending}
              >
                Request review
              </Button>
            )}
            {showResetButton && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetReviewNow}
                disabled={pending}
                className="text-muted-foreground"
                title="Mark every prior review as superseded so reviewers take another look."
              >
                Reset after edits
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Reviewer action form — non-authors only */}
      {!isAuthor && canWrite && (
        <div className="rounded-md border border-border bg-background px-3 py-3 space-y-2">
          <p className="text-xs font-semibold text-foreground">
            Your review
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional review note…"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring resize-y min-h-[3rem]"
            disabled={pending}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => submitDecision("approved")}
              disabled={pending}
            >
              <Check className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => submitDecision("changes_requested")}
              disabled={pending}
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              Request changes
            </Button>
          </div>
        </div>
      )}

      {/* Review list */}
      {hasAnyReview && (
        <ul className="flex flex-col gap-2 list-none">
          {reviews.map((r) => (
            <li key={r.id}>
              <ReviewRow review={r} highlightSelf={r.reviewer_id === currentUserId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewRow({
  review,
  highlightSelf,
}: {
  review: BranchReviewWithReviewer;
  highlightSelf: boolean;
}) {
  const name =
    review.reviewer_display_name ?? review.reviewer_email ?? review.reviewer_id.slice(0, 8);
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background px-3 py-2",
        highlightSelf && "border-primary/40"
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{name}</span>
        {review.decision === "approved" ? (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-600/40 text-emerald-600 text-[10px]"
          >
            <Check className="h-2.5 w-2.5" aria-hidden="true" />
            approved
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 border-destructive/40 text-destructive text-[10px]"
          >
            changes requested
          </Badge>
        )}
        <span className="text-muted-foreground">
          {new Date(review.created_at).toLocaleString()}
        </span>
      </div>
      {review.note && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
          {review.note}
        </p>
      )}
    </div>
  );
}

// ─── Comment threads ────────────────────────────────────────────────────────

/**
 * Per-diff-row comment thread component. Reads its slice from the
 * `CommentsContext` so every expandable diff row (notes, files,
 * skills, agents, folders, …) can drop this in by passing the two
 * coordinates.
 *
 * UI layout:
 *   - Unresolved comments first (prominent).
 *   - Resolved comments collapsed behind a toggle.
 *   - One-level nesting: replies live directly under the parent with
 *     a visual indent; replies-to-replies roll up visually but the
 *     service layer still preserves `parent_comment_id` pointing at
 *     the nearest explicit parent.
 *   - "Add a comment" textarea at the bottom.
 */
function CommentThread({
  objectType,
  objectId,
}: {
  objectType: string;
  objectId: string;
}) {
  const ctx = useComments();
  const all = ctx ? ctx.byKey.get(commentKey(objectType, objectId)) ?? [] : [];
  const [showResolved, setShowResolved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build a tree: top-level comments with their direct replies.
  const topLevel = all.filter((c) => !c.parent_comment_id);
  const repliesByParent = new Map<string, BranchComment[]>();
  for (const c of all) {
    if (c.parent_comment_id) {
      const arr = repliesByParent.get(c.parent_comment_id) ?? [];
      arr.push(c);
      repliesByParent.set(c.parent_comment_id, arr);
    }
  }

  const unresolvedTop = topLevel.filter((c) => !c.resolved);
  const resolvedTop = topLevel.filter((c) => c.resolved);

  function submitBody() {
    if (!ctx) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createBranchCommentAction(
        ctx.branchId,
        objectType,
        objectId,
        trimmed,
        replyTo
      );
      if (res.ok) {
        setBody("");
        setReplyTo(null);
        setError(null);
        window.location.reload();
      } else {
        setError(res.error);
      }
    });
  }

  if (!ctx) return null;

  return (
    <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Comments ({unresolvedTop.length}
          {resolvedTop.length > 0 && ` · ${resolvedTop.length} resolved`})
        </p>
        {resolvedTop.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-fast"
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
        )}
      </div>

      {unresolvedTop.length === 0 && resolvedTop.length === 0 && (
        <p className="text-xs italic text-muted-foreground">
          No comments yet.
        </p>
      )}

      {unresolvedTop.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          replies={repliesByParent.get(c.id) ?? []}
          currentUserId={ctx.currentUserId}
          onReply={() => setReplyTo(c.id)}
        />
      ))}

      {showResolved &&
        resolvedTop.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            replies={repliesByParent.get(c.id) ?? []}
            currentUserId={ctx.currentUserId}
            onReply={() => setReplyTo(c.id)}
          />
        ))}

      {/* Add a comment */}
      <div className="rounded-md border border-border bg-background px-3 py-2 space-y-2">
        {replyTo && (
          <p className="text-[10px] text-muted-foreground">
            Replying to a comment.{" "}
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="underline"
            >
              Cancel
            </button>
          </p>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring resize-y min-h-[2.5rem]"
          disabled={pending}
        />
        {error && (
          <p className="text-[10px] text-destructive">{error}</p>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={submitBody}
            disabled={pending || body.trim().length === 0}
          >
            {pending ? "Posting…" : replyTo ? "Reply" : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  replies,
  currentUserId,
  onReply,
}: {
  comment: BranchComment;
  replies: BranchComment[];
  currentUserId: string;
  onReply: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = comment.author_id === currentUserId;

  function handleResolve() {
    startTransition(async () => {
      const res = comment.resolved
        ? await unresolveBranchCommentAction(comment.id)
        : await resolveBranchCommentAction(comment.id);
      if (res.ok) window.location.reload();
      else setError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteBranchCommentAction(comment.id);
      if (res.ok) window.location.reload();
      else setError(res.error);
    });
  }

  return (
    <div className={cn("space-y-2", comment.resolved && "opacity-60")}>
      <div className="rounded-md border border-border bg-background px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {comment.author_id.slice(0, 8)}
          </span>
          <span>{new Date(comment.created_at).toLocaleString()}</span>
          {comment.resolved && (
            <Badge variant="outline" className="text-[9px]">
              resolved
            </Badge>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-xs">{comment.body}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReply}
            disabled={pending}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-fast"
          >
            Reply
          </button>
          <button
            type="button"
            onClick={handleResolve}
            disabled={pending}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-fast"
          >
            {comment.resolved ? "Unresolve" : "Resolve"}
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-fast"
            >
              Delete
            </button>
          )}
        </div>
        {error && (
          <p className="mt-1 text-[10px] text-destructive">{error}</p>
        )}
      </div>
      {replies.length > 0 && (
        <ul className="ml-4 flex flex-col gap-2 list-none border-l-2 border-border pl-3">
          {replies.map((r) => (
            <li key={r.id}>
              <CommentItem
                comment={r}
                replies={[]}
                currentUserId={currentUserId}
                onReply={onReply}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
