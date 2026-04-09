"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Clock, GitBranch, Loader2, RotateCcw, User, Bot, FileInput } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { rollbackNoteAction } from "@/app/app/notes/[note_id]/actions";
import type { NoteVersion } from "@/server/domain/types/note_version";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VersionListItem extends NoteVersion {
  is_current: boolean;
}

interface DiffSummary {
  title_changed?: boolean;
  body_changed?: boolean;
  summary_changed?: boolean;
  tags_changed?: boolean;
  status_changed?: boolean;
  bytes_added?: number;
  bytes_removed?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ORIGIN_LABEL: Record<string, string> = {
  human_edit: "Human edit",
  import: "Import",
  generated: "Generated",
  proposal_approved: "Proposal approved",
  rollback: "Rollback",
};

const ORIGIN_ICON: Record<string, React.ElementType> = {
  human_edit: User,
  import: FileInput,
  generated: Bot,
  proposal_approved: CheckCircle2,
  rollback: RotateCcw,
};

function originVariant(origin: string): "default" | "secondary" | "outline" {
  if (origin === "rollback") return "outline";
  if (origin === "proposal_approved") return "secondary";
  return "secondary";
}

// ─── DiffBadges ───────────────────────────────────────────────────────────────

function DiffBadges({ diff }: { diff: DiffSummary }) {
  const changes: string[] = [];
  if (diff.title_changed) changes.push("title");
  if (diff.body_changed) changes.push("body");
  if (diff.summary_changed) changes.push("summary");
  if (diff.tags_changed) changes.push("tags");

  if (changes.length === 0 && !diff.bytes_added && !diff.bytes_removed) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {changes.map((c) => (
        <span
          key={c}
          className="rounded-sm bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground"
        >
          {c}
        </span>
      ))}
      {(diff.bytes_added ?? 0) > 0 && (
        <span className="rounded-sm bg-muted px-1 py-0.5 text-[9px] tracking-wide text-emerald-600 dark:text-emerald-400">
          +{diff.bytes_added}B
        </span>
      )}
      {(diff.bytes_removed ?? 0) > 0 && (
        <span className="rounded-sm bg-muted px-1 py-0.5 text-[9px] tracking-wide text-rose-600 dark:text-rose-400">
          -{diff.bytes_removed}B
        </span>
      )}
    </div>
  );
}

// ─── VersionCard ──────────────────────────────────────────────────────────────

function VersionCard({
  version,
  isSelected,
  onSelect,
}: {
  version: VersionListItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const OriginIcon = ORIGIN_ICON[version.change_origin] ?? GitBranch;
  const diff = version.diff_summary as DiffSummary | null;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-md px-3 py-2.5 transition-fast",
        "border border-transparent hover:border-border hover:bg-accent/50",
        isSelected && "border-border bg-accent"
      )}
    >
      <div className="flex items-start gap-2">
        <OriginIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-foreground truncate">
              {version.title}
            </span>
            {version.is_current && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-normal shrink-0">
                current
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground/70">
              v{version.version_number}
            </span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="text-[10px] text-muted-foreground/70">
              {ORIGIN_LABEL[version.change_origin] ?? version.change_origin}
            </span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className="text-[10px] text-muted-foreground/70">
              {formatDate(version.created_at)}
            </span>
          </div>
          {diff && <DiffBadges diff={diff} />}
        </div>
      </div>
    </button>
  );
}

// ─── VersionDetail ────────────────────────────────────────────────────────────

function VersionDetail({
  version,
  noteId,
  onRollbackSuccess,
}: {
  version: VersionListItem;
  noteId: string;
  onRollbackSuccess: (newVersionId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diff = version.diff_summary as DiffSummary | null;
  const OriginIcon = ORIGIN_ICON[version.change_origin] ?? GitBranch;

  function handleRollback() {
    setError(null);
    startTransition(async () => {
      const result = await rollbackNoteAction(noteId, version.id);
      if (result.success) {
        setConfirmOpen(false);
        onRollbackSuccess(result.data.new_version_id);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant={originVariant(version.change_origin)} className="text-[10px]">
            <OriginIcon className="mr-1 h-2.5 w-2.5" />
            {ORIGIN_LABEL[version.change_origin] ?? version.change_origin}
          </Badge>
          {version.is_current && (
            <Badge variant="secondary" className="text-[10px]">current</Badge>
          )}
        </div>
        <h3 className="text-sm font-medium text-foreground">{version.title}</h3>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          <span>Version {version.version_number}</span>
          <span>·</span>
          <span>{formatDate(version.created_at)}</span>
        </div>
      </div>

      <Separator />

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Version ID</p>
          <p className="font-mono text-[11px] text-foreground/80">{version.id.slice(0, 12)}…</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Actor</p>
          <p className="text-foreground/80">{version.actor_type}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Size</p>
          <p className="text-foreground/80">{version.content_bytes} bytes</p>
        </div>
        {version.parent_version_id && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Parent</p>
            <p className="font-mono text-[11px] text-foreground/80">
              {version.parent_version_id.slice(0, 12)}…
            </p>
          </div>
        )}
      </div>

      {/* Diff summary */}
      {diff && (
        <>
          <Separator />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Changes
            </p>
            <div className="flex flex-col gap-1 text-xs">
              {[
                ["Title", diff.title_changed],
                ["Body", diff.body_changed],
                ["Summary", diff.summary_changed],
                ["Tags", diff.tags_changed],
              ].map(([label, changed]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label as string}</span>
                  <span className={cn(
                    "text-[10px]",
                    changed ? "text-foreground" : "text-muted-foreground/40"
                  )}>
                    {changed ? "changed" : "unchanged"}
                  </span>
                </div>
              ))}
              {((diff.bytes_added ?? 0) > 0 || (diff.bytes_removed ?? 0) > 0) && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Size delta</span>
                  <span className="text-[10px] text-foreground/70">
                    {(diff.bytes_added ?? 0) > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">+{diff.bytes_added}B</span>
                    )}
                    {(diff.bytes_added ?? 0) > 0 && (diff.bytes_removed ?? 0) > 0 && " "}
                    {(diff.bytes_removed ?? 0) > 0 && (
                      <span className="text-rose-600 dark:text-rose-400">-{diff.bytes_removed}B</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Content preview */}
      <Separator />
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
          Content snapshot
        </p>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 max-h-48 overflow-y-auto">
          <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">
            {version.markdown_content.length > 800
              ? version.markdown_content.slice(0, 800) + "\n…"
              : version.markdown_content || "(empty)"}
          </pre>
        </div>
        {version.is_current && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/60 italic">
            This is the current version — the note content above matches this snapshot.
          </p>
        )}
      </div>

      {/* Rollback action */}
      {!version.is_current && (
        <>
          <Separator />
          {!confirmOpen ? (
            <button
              onClick={() => setConfirmOpen(true)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-fast",
                "border border-border hover:border-foreground/20 hover:bg-accent/50",
                "text-foreground/80"
              )}
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              Restore this version
            </button>
          ) : (
            <div className="rounded-md border border-border bg-muted/30 p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="text-xs text-foreground/80">
                  This will create a new version with the content of v{version.version_number}.
                  The current version and all history are preserved.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRollback}
                  disabled={isPending}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-fast",
                    "bg-foreground text-background hover:bg-foreground/80",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Confirm restore
                </button>
                <button
                  onClick={() => { setConfirmOpen(false); setError(null); }}
                  disabled={isPending}
                  className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-fast disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── NoteHistoryPanel ─────────────────────────────────────────────────────────

interface NoteHistoryPanelProps {
  noteId: string;
  initialVersions: VersionListItem[];
  currentVersionId: string | null;
}

export function NoteHistoryPanel({
  noteId,
  initialVersions,
  currentVersionId,
}: NoteHistoryPanelProps) {
  const [versions, setVersions] = useState<VersionListItem[]>(initialVersions);
  const [selectedId, setSelectedId] = useState<string | null>(
    currentVersionId ?? initialVersions[0]?.id ?? null
  );

  const selectedVersion = versions.find((v) => v.id === selectedId) ?? null;

  function handleRollbackSuccess(newVersionId: string) {
    // Update is_current flags client-side so the UI reflects the new state
    // without requiring a full page reload.
    setVersions((prev) =>
      prev.map((v) => ({ ...v, is_current: v.id === newVersionId }))
    );
    setSelectedId(newVersionId);
  }

  if (versions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-12">
        No version history yet.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-0 overflow-hidden">
      {/* Version list */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col overflow-hidden">
        <div className="border-b border-border px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {versions.length} version{versions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-0.5 p-2">
            {versions.map((v) => (
              <VersionCard
                key={v.id}
                version={v}
                isSelected={v.id === selectedId}
                onSelect={() => setSelectedId(v.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Version detail */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {selectedVersion ? (
            <VersionDetail
              version={selectedVersion}
              noteId={noteId}
              onRollbackSuccess={handleRollbackSuccess}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a version to inspect it.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
