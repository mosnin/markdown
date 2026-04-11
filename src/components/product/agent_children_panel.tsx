import { File, FileText, Bot, Zap } from "lucide-react";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type ResolvedAgentLink } from "@/components/product/agent_object_links_panel";
import { cn } from "@/lib/utils";

// ─── Object icon ──────────────────────────────────────────────────────────────

function ObjectTypeIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case "note": return <FileText className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    case "file": return <File className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    case "skill": return <Zap className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
    case "agent": return <Bot className={cn("h-4 w-4 shrink-0", className)} aria-hidden="true" />;
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
  /** Links where this agent is source and target is a file or note (structural associations) */
  structuralLinks: ResolvedAgentLink[];
  agentId: string;
}

/**
 * Children tab for the Agent workspace surface.
 *
 * Shows files and notes associated with this agent via semantic links.
 * "Parent of" and "child of" relationships are presented as structural containment.
 * Other relationship types are presented as associations.
 *
 * True database-level containment (agent_id FK on files) is a future database
 * migration. This panel uses the existing object_links system as a foundation.
 */
export function AgentChildrenPanel({ structuralLinks, agentId }: AgentChildrenPanelProps) {
  const parentOf = structuralLinks.filter((l) => l.relationship_type === "parent_of");
  const childOf = structuralLinks.filter((l) => l.relationship_type === "child_of");
  const other = structuralLinks.filter(
    (l) => l.relationship_type !== "parent_of" && l.relationship_type !== "child_of"
  );

  if (structuralLinks.length === 0) {
    return (
      <ScrollArea className="h-full">
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <File className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">No associated objects</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Use the Relationships tab to link files and notes to this agent. Objects linked with{" "}
              <em>Parent of</em> or <em>Child of</em> relationships will appear here as structural associations.
            </p>
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 px-6 py-6">
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
    </ScrollArea>
  );
}
