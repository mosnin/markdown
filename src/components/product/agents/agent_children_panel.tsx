"use client";

import { File, FileText, Bot, Zap, Folder, FolderPlus, Plus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type ResolvedAgentLink } from "@/components/product/agents/agent_object_links_panel";
import { cn } from "@/lib/utils";
import { createAgentChildFileAction, createAgentChildFolderAction } from "@/app/app/agents/actions";
import { SKILL_AGENT_FORMATS, type SkillAgentFormat } from "@/server/domain/constants/object_constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ─── Object icon ──────────────────────────────────────────────────────────────

function ObjectTypeIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case "note": return <FileText className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    case "file": return <File className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    case "skill": return <Zap className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    case "agent": return <Bot className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    case "folder": return <Folder className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    default: return <File className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
  }
}

// ─── Association card ─────────────────────────────────────────────────────────

function AssociatedObjectCard({ link }: { link: ResolvedAgentLink }) {
  const REL_LABEL: Record<string, string> = {
    parent_of: "Contains",
    child_of: "Contained by",
    depends_on: "Depends on",
    related: "Related",
    reference_for: "Reference for",
    extends: "Extends",
    example_of: "Example of",
    sibling_of: "Sibling of",
    supersedes: "Supersedes",
    derived_from: "Derived from",
  };

  return (
    <Link
      href={link.linkedHref}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card p-3",
        "transition-colors duration-150 hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <ObjectTypeIcon type={link.linkedObjectType} className="text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{link.linkedName}</p>
        <p className="text-[11px] text-muted-foreground">
          {REL_LABEL[link.relationship_type] ?? link.relationship_type}
          {link.relationship_note && ` · ${link.relationship_note}`}
        </p>
      </div>
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">
        {link.linkedObjectType}
      </span>
    </Link>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AgentChildrenPanelProps {
  structuralLinks: ResolvedAgentLink[];
  agentId: string;
}

export function AgentChildrenPanel({ structuralLinks, agentId }: AgentChildrenPanelProps) {
  const router = useRouter();
  const [folderOpen, setFolderOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileFormat, setFileFormat] = useState<SkillAgentFormat>("markdown");
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const parentOf = structuralLinks.filter((l) => l.relationship_type === "parent_of");
  const childOf = structuralLinks.filter((l) => l.relationship_type === "child_of");
  const other = structuralLinks.filter(
    (l) => l.relationship_type !== "parent_of" && l.relationship_type !== "child_of"
  );

  return (
    <>
      <ScrollArea className="h-full">
        {structuralLinks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <File className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">No associated objects</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Add a child file or folder to build this agent&#39;s internal package structure.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
                <FolderPlus className="h-3.5 w-3.5" /> Folder
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFileOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> File
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 px-6 py-6">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
                <FolderPlus className="h-3.5 w-3.5" /> Folder
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFileOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> File
              </Button>
            </div>
            {parentOf.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contains
                </h3>
                <div className="flex flex-col gap-2">
                  {parentOf.map((l) => <AssociatedObjectCard key={l.id} link={l} />)}
                </div>
              </section>
            )}

            {childOf.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contained by
                </h3>
                <div className="flex flex-col gap-2">
                  {childOf.map((l) => <AssociatedObjectCard key={l.id} link={l} />)}
                </div>
              </section>
            )}

            {other.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Associated objects
                </h3>
                <div className="flex flex-col gap-2">
                  {other.map((l) => <AssociatedObjectCard key={l.id} link={l} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Dialogs rendered unconditionally so they work in both empty and populated states */}
      <Dialog open={folderOpen} onOpenChange={(v) => { setFolderOpen(v); if (!v) { setFolderName(""); setError(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New child folder</DialogTitle></DialogHeader>
          <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Folder name" autoFocus />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter showCloseButton>
            <Button
              size="sm"
              disabled={isPending || !folderName.trim()}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await createAgentChildFolderAction(agentId, folderName.trim());
                  if (res.ok) { setFolderOpen(false); setFolderName(""); router.refresh(); }
                  else { setError(res.error); }
                });
              }}
            >
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={fileOpen} onOpenChange={(v) => { setFileOpen(v); if (!v) { setFileName(""); setError(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New child file</DialogTitle></DialogHeader>
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="File name" autoFocus />
          <select value={fileFormat} onChange={(e) => setFileFormat(e.target.value as SkillAgentFormat)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            {SKILL_AGENT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter showCloseButton>
            <Button
              size="sm"
              disabled={isPending || !fileName.trim()}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await createAgentChildFileAction(agentId, { filename: fileName.trim(), canonicalFormat: fileFormat });
                  if (res.ok) { setFileOpen(false); setFileName(""); router.refresh(); }
                  else { setError(res.error); }
                });
              }}
            >
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
