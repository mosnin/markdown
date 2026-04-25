"use client";

import { ExternalLink, Globe, Search, MousePointer2, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WebCitation } from "@/server/domain/types/web_tool";

interface WebCitationBadgeProps {
  citation: WebCitation;
  index?: number;
}

/**
 * Inline citation pill shown underneath agent responses. Links to the
 * source URL in a new tab and colour-codes by source_type so a glance
 * tells the reader whether it was an Exa result, Tavily, Browserbase
 * extract, or a plain web_fetch.
 */
export function WebCitationBadge({ citation, index }: WebCitationBadgeProps) {
  const meta = sourceMeta(citation.source_type);
  const Icon = meta.icon;
  const hostname = safeHostname(citation.url);

  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5",
        "text-[10px] text-foreground transition-colors",
        meta.border,
        meta.hoverBg
      )}
      title={citation.title ?? citation.url}
    >
      {index != null && (
        <span className="tabular-nums text-muted-foreground">{index}.</span>
      )}
      <Icon className={cn("h-2.5 w-2.5 shrink-0", meta.iconColor)} aria-hidden="true" />
      <span className="truncate">{citation.title ?? hostname}</span>
      <ExternalLink
        className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
        aria-hidden="true"
      />
    </a>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sourceMeta(type: WebCitation["source_type"]) {
  switch (type) {
    case "exa":
      return {
        icon: Search,
        iconColor: "text-violet-500",
        border: "border-violet-500/30",
        hoverBg: "hover:bg-violet-500/5",
      };
    case "tavily":
      return {
        icon: Search,
        iconColor: "text-blue-500",
        border: "border-blue-500/30",
        hoverBg: "hover:bg-blue-500/5",
      };
    case "browserbase":
      return {
        icon: MousePointer2,
        iconColor: "text-amber-500",
        border: "border-amber-500/30",
        hoverBg: "hover:bg-amber-500/5",
      };
    case "web_fetch":
      return {
        icon: FileCode,
        iconColor: "text-emerald-500",
        border: "border-emerald-500/30",
        hoverBg: "hover:bg-emerald-500/5",
      };
    default:
      return {
        icon: Globe,
        iconColor: "text-muted-foreground",
        border: "border-border",
        hoverBg: "hover:bg-accent/40",
      };
  }
}
