import {
  Archive,
  Bot,
  Calendar,
  Clock,
  GitBranch,
  Tag,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentTypeBadge } from "@/components/product/agents/agent_type_badge";
import { AgentReferenceBadge } from "@/components/product/agents/agent_reference_badge";
import { type Agent } from "@/server/domain/types/agent";
import { type ResolvedAgentLink } from "@/components/product/agents/agent_object_links_panel";
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

// ─── Section components ───────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </h3>
      {children}
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-foreground/80">{children}</span>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AgentOverviewPanelProps {
  agent: Agent;
  boxName: string | null;
  boxId: string | null;
  workspaceName: string;
  outgoingLinks: ResolvedAgentLink[];
  incomingLinks: ResolvedAgentLink[];
  versionCount: number;
  attachmentCount: number;
}

/**
 * Overview tab for the Agent workspace surface.
 *
 * Gives a structured human-readable summary of the Agent before the user opens
 * the raw source. Feels more substantial than the Skill overview because Agents
 * have a structured core (agent_type, model_hint, system_prompt) beyond just a
 * name and canonical source.
 */
export function AgentOverviewPanel({
  agent,
  boxName,
  boxId,
  workspaceName,
  outgoingLinks,
  incomingLinks,
  versionCount,
  attachmentCount,
}: AgentOverviewPanelProps) {
  const linkCount = outgoingLinks.length + incomingLinks.length;

  const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    draft:    { label: "Draft",    className: "text-muted-foreground" },
    active:   { label: "Active",   className: "text-emerald-600 dark:text-emerald-400" },
    archived: { label: "Archived", className: "text-muted-foreground" },
    trashed:  { label: "Trashed",  className: "text-destructive" },
  };
  const statusCfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.active;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 px-6 py-6">
        {/* Status banner */}
        {(agent.status === "archived" || agent.status === "trashed") && (
          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
            {agent.status === "archived" ? (
              <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
            )}
            <p className={cn("text-xs font-medium", statusCfg.className)}>{statusCfg.label}</p>
          </div>
        )}

        {/* Identity */}
        <Section label="Identity">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <AgentReferenceBadge isReusable={agent.is_reusable} />
            {agent.agent_type && <AgentTypeBadge agentType={agent.agent_type} subtle />}
            <span
              className={cn(
                "inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5",
                "font-mono text-[10px] text-muted-foreground"
              )}
            >
              {formatLabel(agent.canonical_format)}
            </span>
            <span className={cn("text-xs font-medium", statusCfg.className)}>
              {statusCfg.label}
            </span>
          </div>
          {agent.description && (
            <p className="text-sm leading-relaxed text-foreground/80">{agent.description}</p>
          )}
        </Section>

        {/* Structured core */}
        <Section label="Core">
          {agent.model_hint && (
            <MetaRow label="Model hint">
              <span className="font-mono text-[11px]">{agent.model_hint}</span>
            </MetaRow>
          )}
          {agent.agent_type && (
            <MetaRow label="Agent type">
              <span className="capitalize">{agent.agent_type}</span>
            </MetaRow>
          )}
          <MetaRow label="Source format">
            <span>{formatLabel(agent.canonical_format)}</span>
          </MetaRow>
          {agent.content_bytes > 0 && (
            <MetaRow label="Source size">
              {agent.content_bytes < 1024
                ? `${agent.content_bytes} B`
                : `${(agent.content_bytes / 1024).toFixed(1)} KB`}
            </MetaRow>
          )}
          {!agent.model_hint && !agent.agent_type && (
            <p className="text-xs text-muted-foreground/60 italic">
              No structured core fields set. Edit the agent to add model hint, agent type, or system prompt.
            </p>
          )}
        </Section>

        {/* System prompt summary */}
        {agent.system_prompt && (
          <Section label="System prompt">
            <p className="font-mono text-[11px] leading-5 text-foreground/70 line-clamp-6 whitespace-pre-wrap break-words">
              {agent.system_prompt}
            </p>
          </Section>
        )}

        {/* Summary */}
        {agent.summary && (
          <Section label="Summary">
            <p className="text-sm leading-relaxed text-foreground/80">{agent.summary}</p>
          </Section>
        )}

        {/* Tags */}
        {agent.tags.length > 0 && (
          <Section label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {agent.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="flex items-center gap-0.5 text-xs font-normal">
                  <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                  {tag}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {/* Metrics */}
        <Section label="At a glance">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Relationships</span>
              <span className="text-lg font-semibold text-foreground tabular-nums">{linkCount}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Versions</span>
              <span className="text-lg font-semibold text-foreground tabular-nums">{versionCount}</span>
            </div>
            {agent.is_reusable && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Attached to</span>
                <span className="text-lg font-semibold text-foreground tabular-nums">{attachmentCount} boxes</span>
              </div>
            )}
          </div>
        </Section>

        {/* Location */}
        <Section label="Location">
          {agent.is_reusable ? (
            <p className="text-xs text-muted-foreground">
              Workspace library →{" "}
              <Link href="/app/agents" className="hover:underline underline-offset-2">
                {workspaceName} / Agents
              </Link>
            </p>
          ) : boxId && boxName ? (
            <p className="text-xs text-muted-foreground">
              Box →{" "}
              <Link
                href={`/app/boxes/${boxId}`}
                className="hover:underline underline-offset-2 hover:text-foreground transition-fast"
              >
                {boxName}
              </Link>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/60">Location unknown</p>
          )}
        </Section>

        {/* Dates */}
        <Section label="Timeline">
          <div className="flex flex-col gap-1.5">
            {agent.current_version_id && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <span className="font-mono text-[11px]">
                  {agent.current_version_id.slice(0, 8)}…
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span>Created {formatDate(agent.created_at)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span>Updated {formatRelativeDate(agent.updated_at)}</span>
            </div>
          </div>
        </Section>
      </div>
    </ScrollArea>
  );
}
