"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AttachToBoxTrigger } from "@/components/product/attach_to_box_trigger";

type Skill = {
  id: string;
  name: string;
  description: string | null;
  canonical_format: string;
  tags: string[];
};

type Box = { id: string; name: string };

export function SkillsListClient({
  skills,
  boxes,
  allTags,
}: {
  skills: Skill[];
  boxes: Box[];
  allTags: string[];
}) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filtered = activeTag
    ? skills.filter((s) => s.tags.includes(activeTag))
    : skills;

  return (
    <div>
      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-6 py-3 border-b border-border">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mr-1">
            Filter
          </span>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs transition-colors",
                activeTag === tag
                  ? "bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 border border-transparent"
              )}
            >
              {tag}
            </button>
          ))}
          {activeTag && (
            <button
              onClick={() => setActiveTag(null)}
              className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {filtered.length} skill{filtered.length === 1 ? "" : "s"}
            {activeTag && (
              <span className="ml-1 normal-case text-muted-foreground/50">
                tagged &ldquo;{activeTag}&rdquo;
              </span>
            )}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((skill) => (
            <SkillCard key={skill.id} skill={skill} boxes={boxes} />
          ))}
        </div>
        {filtered.length === 0 && activeTag && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No skills tagged &ldquo;{activeTag}&rdquo;.{" "}
            <button className="underline hover:text-foreground" onClick={() => setActiveTag(null)}>
              Show all
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill, boxes }: { skill: Skill; boxes: Box[] }) {
  return (
    <div className="relative flex flex-col gap-0">
      <Link
        href={`/app/skills/${skill.id}`}
        className={cn(
          "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4",
          "transition-colors duration-150 hover:bg-accent/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground truncate">{skill.name}</span>
          <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {skill.canonical_format}
          </span>
        </div>
        {skill.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {skill.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tag}
            </span>
          ))}
          <div className="ml-auto">
            <AttachToBoxTrigger
              objectType="skill"
              objectId={skill.id}
              objectName={skill.name}
              boxes={boxes}
            />
          </div>
        </div>
      </Link>
    </div>
  );
}
