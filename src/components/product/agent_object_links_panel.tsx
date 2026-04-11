"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Bot, File, FileText, Link2, Trash2, Zap } from "lucide-react";
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
import {
  RELATIONSHIP_TYPE,
  type RelationshipType,
} from "@/server/domain/constants/note_constants";
import { type ObjectType } from "@/server/domain/constants/object_constants";
import {
  createAgentObjectLinkAction,
  deleteAgentObjectLinkAction,
} from "@/app/app/agents/actions";
import { cn } from "@/lib/utils";

// ─── Relationship labels ──────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedAgentLink {
  id: string;
  relationship_type: RelationshipType;
  relationship_note: string | null;
  linkedObjectType: ObjectType;
  linkedObjectId: string;
  linkedName: string;
  linkedHref: string;
}

export interface AgentLinkTarget {
  id: string;
  objectType: "note" | "file" | "skill" | "agent";
  name: string;
  extension?: string | null;
}

// ─── Object icon ──────────────────────────────────────────────────────────────

function ObjectIcon({ type, className }: { type: ObjectType; className?: string }) {
  switch (type) {
    case "note": return <FileText className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden="true" />;
    case "file": return <File className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden="true" />;
    case "skill": return <Zap className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden="true" />;
    case "agent": return <Bot className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden="true" />;
    default: return <Link2 className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden="true" />;
  }
}

// ─── Create link dialog ───────────────────────────────────────────────────────

function CreateAgentLinkDialog({
  agentId,
  eligibleTargets,
}: {
  agentId: string;
  eligibleTargets: AgentLinkTarget[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [relType, setRelType] = useState<RelationshipType>("related");
  const [relNote, setRelNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTarget = eligibleTargets.find((t) => t.id === targetId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId || !selectedTarget) return;
    setError(null);
    startTransition(async () => {
      const result = await createAgentObjectLinkAction(
        agentId,
        selectedTarget.objectType,
        targetId,
        relType,
        relNote.trim() || null
      );
      if (result.ok) {
        setOpen(false);
        setTargetId("");
        setRelType("related");
        setRelNote("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const noteTargets = eligibleTargets.filter((t) => t.objectType === "note");
  const fileTargets = eligibleTargets.filter((t) => t.objectType === "file");
  const skillTargets = eligibleTargets.filter((t) => t.objectType === "skill");
  const agentTargets = eligibleTargets.filter((t) => t.objectType === "agent");

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(null); } }}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" />}>
        <Link2 className="h-3 w-3" aria-hidden="true" />
        Add link
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add relationship</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-link-target">
              Link to
            </label>
            <select
              id="agent-link-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={isPending}
              required
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">Select an object…</option>
              {noteTargets.length > 0 && (
                <optgroup label="Notes">
                  {noteTargets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
              {fileTargets.length > 0 && (
                <optgroup label="Files">
                  {fileTargets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.extension ?? ""}</option>
                  ))}
                </optgroup>
              )}
              {skillTargets.length > 0 && (
                <optgroup label="Skills">
                  {skillTargets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
              {agentTargets.length > 0 && (
                <optgroup label="Agents">
                  {agentTargets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-link-rel">
              Relationship
            </label>
            <select
              id="agent-link-rel"
              value={relType}
              onChange={(e) => setRelType(e.target.value as RelationshipType)}
              disabled={isPending}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              {Object.entries(RELATIONSHIP_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground/80" htmlFor="agent-link-note">
              Note{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="agent-link-note"
              type="text"
              value={relNote}
              onChange={(e) => setRelNote(e.target.value)}
              disabled={isPending}
              placeholder="Explain this relationship…"
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          )}

          <DialogFooter showCloseButton>
            <Button type="submit" size="sm" disabled={isPending || !targetId}>
              {isPending ? "Adding…" : "Add relationship"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Link row ─────────────────────────────────────────────────────────────────

function AgentLinkRow({
  link,
  isOutgoing,
  agentId,
}: {
  link: ResolvedAgentLink;
  isOutgoing: boolean;
  agentId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteAgentObjectLinkAction(link.id);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2">
      <ObjectIcon type={link.linkedObjectType} className="text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
            {REL_LABEL[link.relationship_type] ?? link.relationship_type}
          </Badge>
          <Link
            href={link.linkedHref}
            className="truncate text-xs font-medium text-foreground hover:underline underline-offset-2"
          >
            {link.linkedName}
          </Link>
        </div>
        {link.relationship_note && (
          <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
            {link.relationship_note}
          </p>
        )}
      </div>
      {isOutgoing && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="shrink-0 rounded p-1 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-fast"
          aria-label={`Remove link to ${link.linkedName}`}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AgentObjectLinksPanelProps {
  agentId: string;
  outgoing: ResolvedAgentLink[];
  incoming: ResolvedAgentLink[];
  eligibleTargets: AgentLinkTarget[];
}

/**
 * Semantic relationships panel for Agents.
 * Shows outgoing ("This agent →") and incoming ("→ Referred by") sections.
 * Supports creating new links via a dialog.
 */
export function AgentObjectLinksPanel({
  agentId,
  outgoing,
  incoming,
  eligibleTargets,
}: AgentObjectLinksPanelProps) {
  const hasLinks = outgoing.length > 0 || incoming.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Outgoing */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
            <h4 className="text-xs font-semibold text-foreground">This agent →</h4>
          </div>
          {eligibleTargets.length > 0 && (
            <CreateAgentLinkDialog agentId={agentId} eligibleTargets={eligibleTargets} />
          )}
        </div>
        {outgoing.length === 0 ? (
          <p className="text-xs text-muted-foreground">No outgoing relationships.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {outgoing.map((link) => (
              <AgentLinkRow key={link.id} link={link} isOutgoing agentId={agentId} />
            ))}
          </div>
        )}
      </div>

      {/* Incoming */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
          <h4 className="text-xs font-semibold text-foreground">→ Referred by</h4>
        </div>
        {incoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing links to this agent yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {incoming.map((link) => (
              <AgentLinkRow key={link.id} link={link} isOutgoing={false} agentId={agentId} />
            ))}
          </div>
        )}
      </div>

      {!hasLinks && eligibleTargets.length === 0 && (
        <p className="text-xs text-muted-foreground/60">
          No objects available to link. Objects in the same box will appear here.
        </p>
      )}
    </div>
  );
}
