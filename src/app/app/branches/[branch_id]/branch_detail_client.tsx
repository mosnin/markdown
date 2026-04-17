"use client";

import { useState, useTransition } from "react";
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
  discardBranchAction,
  setActiveBranchAction,
  detectBranchConflictsAction,
  rebaseBranchAction,
} from "../actions";
import type { DraftBranch } from "@/server/services/branch_service";
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
  authoredByClientName,
}: {
  branch: DraftBranch;
  diff: BranchDiff;
  canWrite: boolean;
  isActive: boolean;
  authoredByClientName?: string | null;
}) {
  const [confirmAction, setConfirmAction] = useState<"promote" | "discard" | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [conflicts, setConflicts] = useState<BranchConflict[] | null>(null);
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  const [rebaseConfirmOpen, setRebaseConfirmOpen] = useState(false);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [prePromoteConflicts, setPrePromoteConflicts] = useState<BranchConflict[] | null>(null);

  const closed = branch.status !== "open";
  const conflictCount = diff.rows.filter((r) => r.mainMovedAhead).length;

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

  return (
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
              disabled={pending || (diff.headCount === 0 && diff.pendingOps.length === 0 && diff.folderOverrides.length === 0 && diff.placementChanges.length === 0 && diff.createdNoteLinks.length === 0 && diff.createdAttachments.length === 0)}
              title={(diff.headCount === 0 && diff.pendingOps.length === 0 && diff.folderOverrides.length === 0 && diff.placementChanges.length === 0 && diff.createdNoteLinks.length === 0 && diff.createdAttachments.length === 0) ? "Nothing to promote" : undefined}
            >
              <PackageOpen className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Promote
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
    </div>
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

function HeadCard({ row }: { row: BranchDiffRow }) {
  const meta = typeMeta[row.objectType];
  const Icon = meta.Icon;
  const [open, setOpen] = useState(false);
  const delta = row.branchBytes - row.mainBytes;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
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
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:divide-x md:divide-border">
            <PreviewColumn
              heading="Main"
              subheading={row.mainVersionId ? `version id ${row.mainVersionId.slice(0, 8)}` : "no version"}
              content={row.mainContent}
              bytes={row.mainBytes}
            />
            <PreviewColumn
              heading="Branch"
              subheading={`version id ${row.branchVersionId.slice(0, 8)}`}
              content={row.branchContent}
              bytes={row.branchBytes}
              highlight
            />
          </div>
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
              <HeadCard row={group.canonical} />
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
                    <HeadCard row={c} />
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
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
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
