"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  File,
  FileText,
  Link2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { type ObjectLink } from "@/server/domain/types/object_link";
import { type ObjectType } from "@/server/domain/constants/object_constants";
import {
  RELATIONSHIP_TYPE,
  type RelationshipType,
} from "@/server/domain/constants/note_constants";
import {
  createFileObjectLinkAction,
  deleteFileObjectLinkAction,
} from "@/app/app/files/actions";
import { cn } from "@/lib/utils";

// ─── Relationship label map ───────────────────────────────────────────────────

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

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  related: "Related — general association",
  depends_on: "Depends on — source requires target",
  parent_of: "Parent of — source is a conceptual parent",
  child_of: "Child of — source is a conceptual child",
  reference_for: "Reference for — source is cited as reference",
  extends: "Extends — source builds upon target",
  example_of: "Example of — source is a concrete example",
  sibling_of: "Sibling of — source and target are peers",
  supersedes: "Supersedes — source replaces target",
  derived_from: "Derived from — source was derived from target",
};

// ─── Linked object resolution types ──────────────────────────────────────────

export interface ResolvedObjectLink {
  id: string;
  relationship_type: RelationshipType;
  relationship_note: string | null;
  linkedObjectType: ObjectType;
  linkedObjectId: string;
  /** Human-readable name for the linked object */
  linkedName: string;
  /** Route href for the linked object */
  linkedHref: string;
}

// Eligible link targets — notes and files from the same box
export interface LinkTarget {
  id: string;
  objectType: "note" | "file";
  name: string;
  /** e.g. ".json", ".py" */
  extension?: string | null;
}

// ─── Create link dialog ───────────────────────────────────────────────────────

function CreateFileLinkDialog({
  fileId,
  eligibleTargets,
}: {
  fileId: string;
  eligibleTargets: LinkTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [targetType, setTargetType] = useState<"note" | "file">("note");
  const [relType, setRelType] = useState<RelationshipType>(RELATIONSHIP_TYPE.RELATED);
  const [relNote, setRelNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const sorted = [...eligibleTargets].sort((a, b) => a.name.localeCompare(b.name));

  function reset() {
    setTargetId("");
    setTargetType("note");
    setRelType(RELATIONSHIP_TYPE.RELATED);
    setRelNote("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleTargetChange(value: string) {
    if (!value) {
      setTargetId("");
      return;
    }
    const [type, id] = value.split(":", 2) as ["note" | "file", string];
    setTargetId(id);
    setTargetType(type);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return;
    setError(null);

    startTransition(async () => {
      const result = await createFileObjectLinkAction(
        fileId,
        targetType,
        targetId,
        relType,
        relNote.trim() || null
      );
      if (result.ok) {
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const currentValue = targetId ? `${targetType}:${targetId}` : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button size="sm" variant="outline" className="gap-1.5" />}
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        Add link
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link to another object</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Target object */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="file-link-target">
              Target
            </label>
            {sorted.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No other notes or files in this box yet.
              </p>
            ) : (
              <select
                id="file-link-target"
                value={currentValue}
                onChange={(e) => handleTargetChange(e.target.value)}
                required
                disabled={isPending}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="">Select a target…</option>
                {/* Notes */}
                {sorted.filter((t) => t.objectType === "note").length > 0 && (
                  <optgroup label="Notes">
                    {sorted
                      .filter((t) => t.objectType === "note")
                      .map((t) => (
                        <option key={t.id} value={`note:${t.id}`}>
                          {t.name} .md
                        </option>
                      ))}
                  </optgroup>
                )}
                {/* Files */}
                {sorted.filter((t) => t.objectType === "file").length > 0 && (
                  <optgroup label="Files">
                    {sorted
                      .filter((t) => t.objectType === "file")
                      .map((t) => (
                        <option key={t.id} value={`file:${t.id}`}>
                          {t.name}{t.extension ?? ""}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>

          {/* Relationship type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="file-link-rel-type">
              Relationship
            </label>
            <select
              id="file-link-rel-type"
              value={relType}
              onChange={(e) => setRelType(e.target.value as RelationshipType)}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {(Object.values(RELATIONSHIP_TYPE) as RelationshipType[]).map((t) => (
                <option key={t} value={t}>
                  {RELATIONSHIP_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Relationship note */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="file-link-rel-note">
              Note{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="file-link-rel-note"
              value={relNote}
              onChange={(e) => setRelNote(e.target.value)}
              disabled={isPending}
              rows={2}
              placeholder="Describe the specific nature of this connection…"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter showCloseButton>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !targetId || sorted.length === 0}
            >
              {isPending ? "Linking…" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Link row ─────────────────────────────────────────────────────────────────

function ObjectLinkRow({
  link,
  direction,
}: {
  link: ResolvedObjectLink;
  direction: "outgoing" | "incoming";
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteFileObjectLinkAction(link.id);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const ObjectIcon = link.linkedObjectType === "note" ? FileText : File;

  return (
    <div className="group flex flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-2 text-sm">
      <div className="flex items-center gap-2">
        {/* Relationship badge */}
        <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
          {REL_LABEL[link.relationship_type] ?? link.relationship_type}
        </Badge>

        {/* Object type icon + link name */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ObjectIcon
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
            aria-hidden="true"
          />
          <Link
            href={link.linkedHref}
            className="truncate text-foreground hover:underline underline-offset-2"
          >
            {link.linkedName}
          </Link>
        </div>

        {/* Delete — outgoing only */}
        {direction === "outgoing" && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-fast group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label="Remove context relationship"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {link.relationship_note && (
        <p className="pl-0.5 text-[11px] italic text-muted-foreground/70 leading-relaxed">
          {link.relationship_note}
        </p>
      )}

      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface FileObjectLinksPanelProps {
  fileId: string;
  outgoing: ResolvedObjectLink[];
  incoming: ResolvedObjectLink[];
  eligibleTargets: LinkTarget[];
}

/**
 * Presents file–object relationships as explicit semantic context — not backlinks.
 * Uses object_links (not note_links) to support heterogeneous source/target types.
 */
export function FileObjectLinksPanel({
  fileId,
  outgoing,
  incoming,
  eligibleTargets,
}: FileObjectLinksPanelProps) {
  const hasLinks = outgoing.length > 0 || incoming.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Context relationships
        </h3>
        <CreateFileLinkDialog fileId={fileId} eligibleTargets={eligibleTargets} />
      </div>

      {/* Empty state */}
      {!hasLinks && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          No context relationships yet. Links define how this file relates to
          other objects — included automatically in context bundle assembly.
        </p>
      )}

      {/* Outgoing */}
      {outgoing.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
            This file →
          </p>
          <div className="flex flex-col gap-1">
            {outgoing.map((link) => (
              <ObjectLinkRow key={link.id} link={link} direction="outgoing" />
            ))}
          </div>
        </div>
      )}

      {/* Incoming */}
      {incoming.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            → Referred by
          </p>
          <div className="flex flex-col gap-1">
            {incoming.map((link) => (
              <ObjectLinkRow key={link.id} link={link} direction="incoming" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
