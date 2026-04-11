"use client";

import Link from "next/link";
import {
  Archive,
  Calendar,
  ChevronRight,
  Clock,
  GitBranch,
  Tag,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentTypeBadge } from "@/components/product/agent_type_badge";
import { AgentReferenceBadge } from "@/components/product/agent_reference_badge";
import {
  AgentObjectLinksPanel,
  type ResolvedAgentLink,
  type AgentLinkTarget,
} from "@/components/product/agent_object_links_panel";
import { type Agent } from "@/server/domain/types/agent";
import { type ObjectVersion } from "@/server/domain/types/object_version";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(dateStr);
}

function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    markdown: "Markdown",
    json: "JSON",
    yaml: "YAML",
    python: "Python",
    typescript: "TypeScript",
  };
  return labels[format] ?? format;
}

// ─── Info sub-components ──────────────────────────────────────────────────────

function InfoSection({ children, border = true }: { children: React.ReactNode; border?: boolean }) {
  return (
    <div className={cn("px-4 py-3", border && "border-b border-border")}>
      {children}
    </div>
  );
}

function InfoLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  );
}

// ─── Version item ─────────────────────────────────────────────────────────────

function VersionItem({ version, isCurrent }: { version: ObjectVersion; isCurrent: boolean }) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-xs", isCurrent && "bg-muted/40")}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground/60">v{version.version_number}</span>
        {isCurrent && (
          <Badge variant="secondary" className="text-[9px] font-normal">current</Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{formatRelativeDate(version.created_at)}</span>
      </div>
      {version.change_origin && version.change_origin !== "human_edit" && (
        <span className="text-[10px] text-muted-foreground/50 capitalize">
          {version.change_origin.replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

const VALID_TABS = ["info", "links", "history"] as const;
type AgentContextTab = typeof VALID_TABS[number];

interface AgentContextPanelProps {
  agent: Agent;
  boxId: string | null;
  boxName: string | null;
  workspaceName: string;
  outgoingLinks: ResolvedAgentLink[];
  incomingLinks: ResolvedAgentLink[];
  eligibleLinkTargets: AgentLinkTarget[];
  versions: ObjectVersion[];
  defaultTab?: AgentContextTab;
}

/**
 * Right-pane context panel for the Agent workspace surface.
 *
 * Three tabs: Info (metadata), Links (semantic relationships), History (versions).
 * No Bundle tab — agents do not have context bundles in this version.
 *
 * The Info tab is heavier than the Skill equivalent because agents have a
 * structured core (agent_type, model_hint, system_prompt) plus reusability state.
 */
export function AgentContextPanel({
  agent,
  boxId,
  boxName,
  workspaceName,
  outgoingLinks,
  incomingLinks,
  eligibleLinkTargets,
  versions,
  defaultTab = "info",
}: AgentContextPanelProps) {
  const linkCount = outgoingLinks.length + incomingLinks.length;

  const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    draft:    { label: "Draft",    className: "" },
    active:   { label: "Active",   className: "text-emerald-600 dark:text-emerald-400" },
    archived: { label: "Archived", className: "text-muted-foreground" },
    trashed:  { label: "Trashed",  className: "text-destructive" },
  };
  const statusCfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.active;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Agent context
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-4">
          <TabsList variant="line" className="h-auto pb-0">
            <TabsTrigger value="info" className="pb-2.5 text-xs">Info</TabsTrigger>
            <TabsTrigger value="links" className="relative pb-2.5 text-xs">
              Links
              {linkCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1 text-[10px] text-muted-foreground">
                  {linkCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="pb-2.5 text-xs">History</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Info tab ── */}
        <TabsContent value="info" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            {/* Status banner */}
            {(agent.status === "archived" || agent.status === "trashed") && (
              <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {agent.status === "archived" ? (
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                  )}
                  <p className={cn("text-xs font-medium", statusCfg.className)}>
                    {statusCfg.label}
                  </p>
                </div>
              </div>
            )}

            {/* Identity */}
            <InfoSection>
              <p className="font-medium text-sm text-foreground break-words">{agent.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <AgentReferenceBadge isReusable={agent.is_reusable} />
                {agent.agent_type && <AgentTypeBadge agentType={agent.agent_type} subtle />}
              </div>
              {agent.description && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {agent.description}
                </p>
              )}
            </InfoSection>

            {/* Format */}
            <InfoSection>
              <InfoLabel>Source format</InfoLabel>
              <span className={cn(
                "inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5",
                "font-mono text-[10px] text-muted-foreground"
              )}>
                {formatLabel(agent.canonical_format)}
              </span>
            </InfoSection>

            {/* Structured core */}
            {(agent.model_hint || agent.agent_type) && (
              <InfoSection>
                <InfoLabel>Core</InfoLabel>
                {agent.agent_type && (
                  <div className="flex gap-2 text-xs">
                    <span className="w-20 shrink-0 text-muted-foreground/60">Type</span>
                    <span className="capitalize text-foreground/70">{agent.agent_type}</span>
                  </div>
                )}
                {agent.model_hint && (
                  <div className="flex gap-2 text-xs mt-1">
                    <span className="w-20 shrink-0 text-muted-foreground/60">Model</span>
                    <span className="font-mono text-[11px] text-foreground/70 break-all">{agent.model_hint}</span>
                  </div>
                )}
              </InfoSection>
            )}

            {/* System prompt */}
            {agent.system_prompt && (
              <InfoSection>
                <InfoLabel>System prompt</InfoLabel>
                <p className="font-mono text-[10px] leading-5 text-muted-foreground/70 line-clamp-4 whitespace-pre-wrap break-words">
                  {agent.system_prompt}
                </p>
              </InfoSection>
            )}

            {/* Size */}
            <InfoSection>
              <InfoLabel>Size</InfoLabel>
              <p className="text-xs text-foreground/70">
                {agent.content_bytes < 1024
                  ? `${agent.content_bytes} B`
                  : `${(agent.content_bytes / 1024).toFixed(1)} KB`}
              </p>
            </InfoSection>

            {/* Tags */}
            {agent.tags.length > 0 && (
              <InfoSection>
                <InfoLabel>Tags</InfoLabel>
                <div className="flex flex-wrap gap-1">
                  {agent.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="flex items-center gap-0.5 text-xs font-normal">
                      <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              </InfoSection>
            )}

            {/* Summary */}
            {agent.summary && (
              <InfoSection>
                <InfoLabel>Summary</InfoLabel>
                <p className="text-xs leading-relaxed text-foreground/80">{agent.summary}</p>
              </InfoSection>
            )}

            {/* Location */}
            <InfoSection>
              <InfoLabel>Location</InfoLabel>
              {agent.is_reusable ? (
                <nav aria-label="Agent location" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Link href="/app" className="hover:text-foreground hover:underline underline-offset-2 transition-fast">
                    {workspaceName}
                  </Link>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                  <Link href="/app/agents" className="hover:text-foreground hover:underline underline-offset-2 transition-fast">
                    Agents
                  </Link>
                </nav>
              ) : boxId && boxName ? (
                <nav aria-label="Agent location" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Link href="/app" className="hover:text-foreground hover:underline underline-offset-2 transition-fast">
                    {workspaceName}
                  </Link>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                  <Link href={`/app/boxes/${boxId}`} className="hover:text-foreground hover:underline underline-offset-2 transition-fast">
                    {boxName}
                  </Link>
                </nav>
              ) : (
                <p className="text-xs text-muted-foreground/60">Workspace library</p>
              )}
            </InfoSection>

            {/* Version / dates */}
            <InfoSection border={false}>
              <InfoLabel>Version</InfoLabel>
              <div className="flex flex-col gap-1.5 text-xs">
                {agent.current_version_id && (
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    <span className="font-mono text-[11px] text-foreground/70">
                      {agent.current_version_id.slice(0, 8)}…
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="text-foreground/70">Created {formatDate(agent.created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="text-foreground/70">{formatRelativeDate(agent.updated_at)}</span>
                </div>
              </div>
            </InfoSection>
          </ScrollArea>
        </TabsContent>

        {/* ── Links tab ── */}
        <TabsContent value="links" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 py-3">
              <AgentObjectLinksPanel
                agentId={agent.id}
                outgoing={outgoingLinks}
                incoming={incomingLinks}
                eligibleTargets={eligibleLinkTargets}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── History tab ── */}
        <TabsContent value="history" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 py-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Version history
              </h3>
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No versions recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {versions.map((v) => (
                    <VersionItem
                      key={v.id}
                      version={v}
                      isCurrent={v.id === agent.current_version_id}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
