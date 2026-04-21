"use client";

import { useState, useTransition } from "react";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  AlertTriangle,
  ChevronRight,
  GitBranch,
  Clock,
  Info,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type ContextBundle,
  type BundleNoteRef,
  type BundleLinkedNote,
} from "@/server/domain/types/context_bundle";
import { assembleContextBundleAction } from "@/app/app/notes/actions";

// ─── Truncation reason labels ─────────────────────────────────────────────────

const TRUNCATION_LABELS: Record<string, string> = {
  linked_limit_reached: "Linked notes were capped by the limit.",
  guide_excluded_by_option: "Guide note was excluded (turned off above).",
  ancestor_summary_not_found:
    "No ancestor summary note found (note may be at root level, or no folder has a note with read_hint 'core_reference' or 'read_first').",
  archived_excluded: "Some linked notes are archived and were excluded.",
};

// ─── Relationship labels (10-value canonical vocabulary) ──────────────────────

const REL_LABEL: Record<string, string> = {
  related: "Related to",
  depends_on: "Depends on",
  parent_of: "Parent of",
  child_of: "Child of",
  reference_for: "Reference for",
  extends: "Extends",
  example_of: "Example of",
  sibling_of: "Sibling of",
  supersedes: "Supersedes",
  derived_from: "Derived from",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({
  children,
  badge,
}: {
  children: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </p>
      {badge && (
        <Badge variant="secondary" className="text-[10px] font-normal">
          {badge}
        </Badge>
      )}
    </div>
  );
}

function NoteCard({
  note,
  label,
  labelBadge,
  showPath = true,
}: {
  note: BundleNoteRef;
  label?: string;
  labelBadge?: string;
  showPath?: boolean;
}) {
  const kindLabel: Record<string, string> = {
    note: "Note",
    guide: "Guide",
    bundle: "Bundle",
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3">
      {label && <SectionLabel badge={labelBadge}>{label}</SectionLabel>}

      <div className="flex items-start gap-2">
        <Link
          href={`/app/notes/${note.id}`}
          className="flex-1 text-sm font-medium text-foreground hover:underline underline-offset-2 leading-snug"
        >
          {note.title}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {note.kind !== "note" && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal capitalize"
            >
              {kindLabel[note.kind] ?? note.kind}
            </Badge>
          )}
        </div>
      </div>

      {showPath && note.folder_path_cache && (
        <p className="text-[11px] text-muted-foreground/60 font-mono">
          {note.folder_path_cache}
        </p>
      )}

      {note.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {note.summary}
        </p>
      )}

      {note.read_hint && (
        <p className="text-xs text-muted-foreground/60 italic line-clamp-2">
          {note.read_hint}
        </p>
      )}

      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] font-normal">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkedNoteCard({ note }: { note: BundleLinkedNote }) {
  const isOutgoing = note.direction === "outgoing";

  return (
    <div className="flex flex-col gap-0 rounded-md border border-border bg-card">
      <div className="flex items-start gap-2.5 p-3">
        {/* Direction arrow */}
        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
          {isOutgoing ? (
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
          ) : (
            <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-2">
            <Link
              href={`/app/notes/${note.id}`}
              className="flex-1 truncate text-sm font-medium text-foreground hover:underline underline-offset-2"
            >
              {note.title}
            </Link>
            <Badge
              variant="secondary"
              className="shrink-0 text-[10px] font-normal"
            >
              {REL_LABEL[note.relationship_type] ?? note.relationship_type.replace(/_/g, " ")}
            </Badge>
          </div>

          {note.folder_path_cache && (
            <p className="font-mono text-[10px] text-muted-foreground/50">
              {note.folder_path_cache}
            </p>
          )}

          {note.summary && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {note.summary}
            </p>
          )}
        </div>
      </div>

      {/* Relationship annotation */}
      {note.relationship_note && (
        <div className="border-t border-border/50 px-3 pb-2.5 pt-2">
          <p className="text-[11px] italic leading-relaxed text-muted-foreground/70">
            {note.relationship_note}
          </p>
        </div>
      )}
    </div>
  );
}

function VersionCard({ bundle }: { bundle: ContextBundle }) {
  const { version_info, target_note } = bundle;

  function fmt(dateStr: string) {
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
    import: "Imported",
    generated: "AI generated",
    proposal_approved: "Proposal approved",
  };

  return (
    <div className="rounded-md border border-border bg-card p-3 flex flex-col gap-1.5">
      <SectionLabel>Version info</SectionLabel>
      <div className="flex flex-col gap-1 text-xs">
        {version_info.current_version_id && (
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="font-mono text-[11px] text-foreground/70">
              {version_info.current_version_id.slice(0, 8)}…
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span className="text-foreground/70">{fmt(version_info.updated_at)}</span>
        </div>
        {version_info.change_origin && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground/50">Origin:</span>
            <span className="text-foreground/70">
              {ORIGIN_LABEL[version_info.change_origin] ?? version_info.change_origin}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ParentPathDisplay({ bundle }: { bundle: ContextBundle }) {
  const { parent_path, box } = bundle;

  if (parent_path.folder_names.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground">
      <span className="text-foreground/60">{box.name}</span>
      {parent_path.folder_names.map((name, i) => (
        <span key={`${name}-${i}`} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
          <span className="text-foreground/70">{name}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Options bar ──────────────────────────────────────────────────────────────

interface BundleOptions {
  includeGuide: boolean;
  includeAncestorSummary: boolean;
  linkedLimit: number;
}

function OptionsBar({
  options,
  onChange,
  pending,
}: {
  options: BundleOptions;
  onChange: (o: BundleOptions) => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/30 px-4 py-2.5 text-xs">
      {/* Include guide */}
      <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
        <input
          type="checkbox"
          checked={options.includeGuide}
          onChange={(e) =>
            onChange({ ...options, includeGuide: e.target.checked })
          }
          disabled={pending}
          className="rounded"
        />
        Include guide note
      </label>

      {/* Include ancestor summary */}
      <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
        <input
          type="checkbox"
          checked={options.includeAncestorSummary}
          onChange={(e) =>
            onChange({ ...options, includeAncestorSummary: e.target.checked })
          }
          disabled={pending}
          className="rounded"
        />
        Include ancestor summary
      </label>

      {/* Linked limit */}
      <label className="flex items-center gap-2 text-muted-foreground">
        Linked notes:
        <select
          value={options.linkedLimit}
          onChange={(e) =>
            onChange({ ...options, linkedLimit: parseInt(e.target.value, 10) })
          }
          disabled={pending}
          className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {[1, 2, 3, 5, 7, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      {pending && (
        <span className="text-muted-foreground/60 italic">Assembling…</span>
      )}
    </div>
  );
}

// ─── Truncation notice ────────────────────────────────────────────────────────

function TruncationNotice({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50/50 px-3 py-2.5 dark:border-amber-600/30 dark:bg-amber-900/10">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          Bundle is partial
        </p>
        <ul className="flex flex-col gap-0.5">
          {reasons.map((r) => (
            <li key={r} className="text-xs text-amber-600/80 dark:text-amber-400/80">
              {TRUNCATION_LABELS[r] ?? r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Assembly footer ──────────────────────────────────────────────────────────

function AssemblyFooter({ metadata }: { metadata: ContextBundle["assembly_metadata"] }) {
  const assembledAt = new Date(metadata.assembled_at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex items-center gap-1.5 border-t border-border pt-4 text-[10px] text-muted-foreground/50">
      <Info className="h-3 w-3" />
      <span>
        Assembled at {assembledAt} — {metadata.linked_limit} linked note limit —
        {metadata.include_archived ? " archived included" : " archived excluded"} —
        trashed always excluded
      </span>
    </div>
  );
}

// ─── Main viewer ──────────────────────────────────────────────────────────────

interface ContextBundleViewerProps {
  initialBundle: ContextBundle;
  noteId: string;
}

/**
 * Context Bundle Viewer.
 *
 * Displays a deterministic, bounded context package for a target note.
 * Users can adjust assembly options to control what's included.
 * Re-assembly happens via the assembleContextBundleAction server action.
 *
 * Shows:
 *   - Target note (title, path, summary, tags)
 *   - Guide note (if included and assigned)
 *   - Ancestor summary note (if resolved)
 *   - Linked notes in ranked order (relationship type, direction)
 *   - Version info for the target note
 *   - Truncation notice with specific reasons
 *   - Assembly metadata footer
 */
export function ContextBundleViewer({
  initialBundle,
  noteId,
}: ContextBundleViewerProps) {
  const [bundle, setBundle] = useState<ContextBundle>(initialBundle);
  const [options, setOptions] = useState<BundleOptions>({
    includeGuide: initialBundle.assembly_metadata.include_guide,
    includeAncestorSummary: initialBundle.assembly_metadata.include_ancestor_summary,
    linkedLimit: initialBundle.assembly_metadata.linked_limit,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOptionsChange(newOptions: BundleOptions) {
    setOptions(newOptions);
    setError(null);
    startTransition(async () => {
      const result = await assembleContextBundleAction(noteId, {
        includeGuide: newOptions.includeGuide,
        includeAncestorSummary: newOptions.includeAncestorSummary,
        linkedLimit: newOptions.linkedLimit,
      });
      if (result.ok) {
        setBundle(result.data);
      } else {
        setError(result.error);
      }
    });
  }

  const { target_note, guide_note, ancestor_summary_note, linked_notes } = bundle;

  return (
    <div className={cn("flex flex-col gap-5", isPending && "opacity-70 transition-opacity")}>
      {/* Options */}
      <OptionsBar options={options} onChange={handleOptionsChange} pending={isPending} />

      {/* Error */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Truncation notice */}
      <TruncationNotice reasons={bundle.truncation_reasons} />

      {/* Parent path (context header) */}
      {bundle.parent_path.folder_names.length > 0 && (
        <div className="flex flex-col gap-1">
          <SectionLabel>Location</SectionLabel>
          <ParentPathDisplay bundle={bundle} />
        </div>
      )}

      {/* Target note */}
      <div>
        <NoteCard
          note={target_note}
          label="Target note"
          showPath={false}
        />
      </div>

      {/* Version info */}
      <VersionCard bundle={bundle} />

      {/* Guide note */}
      {guide_note && (
        <div>
          <NoteCard
            note={guide_note}
            label="Guide note"
            labelBadge="Box guide"
          />
        </div>
      )}

      {/* Ancestor summary */}
      {ancestor_summary_note && (
        <div>
          <NoteCard
            note={ancestor_summary_note}
            label="Ancestor summary"
            labelBadge={
              ancestor_summary_note.read_hint === "core_reference"
                ? "core reference"
                : ancestor_summary_note.read_hint ?? undefined
            }
          />
        </div>
      )}

      {/* Linked notes */}
      {linked_notes.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>
            Linked notes ({linked_notes.length}
            {bundle.assembly_metadata.total_linked_available > linked_notes.length
              ? ` of ${bundle.assembly_metadata.total_linked_available}`
              : ""}
            )
          </SectionLabel>

          <div className="flex flex-col gap-2">
            {linked_notes.map((ln) => (
              <LinkedNoteCard key={ln.id} note={ln} />
            ))}
          </div>

          {bundle.truncation_reasons.includes("linked_limit_reached") && (
            <p className="text-xs text-muted-foreground/60 italic">
              Showing {linked_notes.length} of{" "}
              {bundle.assembly_metadata.total_linked_available} linked notes.
              Increase the limit above to see more.
            </p>
          )}
        </div>
      )}

      {linked_notes.length === 0 &&
        !guide_note &&
        !ancestor_summary_note && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No linked context found. Add links to this note or assign a guide
            note to the box.
          </p>
        )}

      {/* Assembly metadata footer */}
      <AssemblyFooter metadata={bundle.assembly_metadata} />
    </div>
  );
}
