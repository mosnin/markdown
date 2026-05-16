"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AttachToBoxTrigger } from "@/components/product/attach_to_box_trigger";
import { AgentTypeBadge } from "@/components/product/agents/agent_type_badge";
import { PageStagger, StaggerItem } from "@/components/product/page_transition";

type Agent = {
  id: string;
  name: string;
  description: string | null;
  agent_type: string | null;
  tags: string[];
  canonical_format: string;
  status: string;
};

type Box = { id: string; name: string };

export function AgentsListClient({
  agents,
  boxes,
  allTags,
}: {
  agents: Agent[];
  boxes: Box[];
  allTags: string[];
}) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filtered = activeTag
    ? agents.filter((a) => a.tags.includes(activeTag))
    : agents;

  return (
    <div>
      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-6 py-3 border-b border-border">
          <span className="text-overline mr-1">
            Filter
          </span>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={cn(
                "rounded-md px-2.5 py-0.5 text-xs transition-colors",
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
          <p className="text-overline text-muted-foreground">
            {filtered.length} agent{filtered.length === 1 ? "" : "s"}
            {activeTag && (
              <span className="ml-1 normal-case text-muted-foreground/50">
                tagged &ldquo;{activeTag}&rdquo;
              </span>
            )}
          </p>
        </div>
        <PageStagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((agent) => (
            <StaggerItem key={agent.id}>
              <AgentCard agent={agent} boxes={boxes} />
            </StaggerItem>
          ))}
        </PageStagger>
        {filtered.length === 0 && activeTag && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No agents tagged &ldquo;{activeTag}&rdquo;.{" "}
            <button className="underline hover:text-foreground" onClick={() => setActiveTag(null)}>
              Show all
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent, boxes }: { agent: Agent; boxes: Box[] }) {
  return (
    <div className="relative flex flex-col gap-0">
      <Link
        href={`/app/agents/${agent.id}`}
        className={cn(
          "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4",
          "transition-[border-color,box-shadow] duration-150 hover:border-strong hover:shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground truncate flex-1">{agent.name}</span>
          {agent.agent_type && (
            <AgentTypeBadge agentType={agent.agent_type} subtle className="ml-auto shrink-0" />
          )}
        </div>
        {agent.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {agent.canonical_format}
          </span>
          {agent.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {agent.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="ml-auto">
            <AttachToBoxTrigger
              objectType="agent"
              objectId={agent.id}
              objectName={agent.name}
              boxes={boxes}
            />
          </div>
        </div>
      </Link>
    </div>
  );
}
