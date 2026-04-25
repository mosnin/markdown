"use client";

import { File, Zap } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type ResolvedAgentLink } from "@/components/product/agent_object_links_panel";
import { cn } from "@/lib/utils";
import { attachSkillToAgentAction } from "@/app/app/agents/actions";
import { Button } from "@/components/ui/button";

// ─── Skill/file reference card ────────────────────────────────────────────────

function ReferenceCard({
  link,
  strong,
}: {
  link: ResolvedAgentLink;
  strong?: boolean;
}) {
  const REL_LABEL: Record<string, string> = {
    depends_on: "Depends on",
    extends: "Extends",
    related: "Related",
    reference_for: "Reference for",
    parent_of: "Parent of",
    child_of: "Child of",
    sibling_of: "Sibling of",
    supersedes: "Supersedes",
    derived_from: "Derived from",
    example_of: "Example of",
  };

  return (
    <Link
      href={link.linkedHref}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-colors duration-150",
        "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        strong
          ? "border-border bg-card shadow-sm"
          : "border-border/60 bg-muted/10"
      )}
    >
      {link.linkedObjectType === "file" ? (
        <File className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <Zap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
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

interface AgentSkillsPanelProps {
  /** All outgoing links from this agent — filtered client-side for skills and files */
  outgoingLinks: ResolvedAgentLink[];
  agentId: string;
  availableSkills?: Array<{ id: string; name: string }>;
}

/**
 * Skills tab for the Agent workspace surface.
 *
 * Shows skills and files referenced by this agent via semantic relationships.
 * "Depends on" links are presented as strong dependencies (prominent visual).
 * Other relationship types are presented as associations.
 *
 * Skills are presented first, files second.
 * Uses the existing object_links system — the same links also appear in the
 * Relationships tab, but here they are filtered and presented with more structure.
 */
export function AgentSkillsPanel({ outgoingLinks, agentId, availableSkills = [] }: AgentSkillsPanelProps) {
  const router = useRouter();
  const [skillId, setSkillId] = useState("");
  const [isPending, start] = useTransition();
  const skillLinks = outgoingLinks.filter((l) => l.linkedObjectType === "skill");
  const fileLinks = outgoingLinks.filter((l) => l.linkedObjectType === "file");

  const strongSkills = skillLinks.filter((l) => l.relationship_type === "depends_on");
  const otherSkills = skillLinks.filter((l) => l.relationship_type !== "depends_on");
  const strongFiles = fileLinks.filter((l) => l.relationship_type === "depends_on");
  const otherFiles = fileLinks.filter((l) => l.relationship_type !== "depends_on");

  const hasSkills = skillLinks.length > 0;
  const hasFiles = fileLinks.length > 0;

  if (!hasSkills && !hasFiles) {
    return (
      <ScrollArea className="h-full">
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Zap className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">No skill or file references</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Add a skill dependency directly from this tab, or use Relationships for loose semantic links.
            </p>
          </div>
          {availableSkills.length > 0 && (
            <div className="flex items-center gap-2">
              <select value={skillId} onChange={(e) => setSkillId(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                <option value="">Select skill…</option>
                {availableSkills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending || !skillId}
                onClick={() => start(async () => { await attachSkillToAgentAction(agentId, skillId); setSkillId(""); router.refresh(); })}
              >
                Attach skill
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 px-6 py-6">
        {availableSkills.length > 0 && (
          <div className="flex items-center gap-2">
            <select value={skillId} onChange={(e) => setSkillId(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              <option value="">Select skill…</option>
              {availableSkills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending || !skillId}
              onClick={() => start(async () => { await attachSkillToAgentAction(agentId, skillId); setSkillId(""); router.refresh(); })}
            >
              Attach skill
            </Button>
          </div>
        )}
        {hasSkills && (
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Skills
            </h3>
            {strongSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Dependencies</p>
                {strongSkills.map((l) => <ReferenceCard key={l.id} link={l} strong />)}
              </div>
            )}
            {otherSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                {strongSkills.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Associations</p>
                )}
                {otherSkills.map((l) => <ReferenceCard key={l.id} link={l} />)}
              </div>
            )}
          </section>
        )}

        {hasFiles && (
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Files
            </h3>
            {strongFiles.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Dependencies</p>
                {strongFiles.map((l) => <ReferenceCard key={l.id} link={l} strong />)}
              </div>
            )}
            {otherFiles.length > 0 && (
              <div className="flex flex-col gap-2">
                {strongFiles.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Associations</p>
                )}
                {otherFiles.map((l) => <ReferenceCard key={l.id} link={l} />)}
              </div>
            )}
          </section>
        )}
      </div>
    </ScrollArea>
  );
}
