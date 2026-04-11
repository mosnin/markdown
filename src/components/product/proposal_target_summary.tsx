import { FileCode, Zap, Bot, FileText, FolderOpen, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ProposalTargetSummary
 *
 * Compact header shown at the top of a proposal card or review screen
 * to clearly communicate what the proposal targets.
 *
 * Shows:
 *   - Target object type icon
 *   - Target object type label (Note, File, Skill, Agent)
 *   - Target object name (if known)
 *   - Proposal action (create / update / append / replace)
 *   - Format (if relevant for files/skills/agents)
 *
 * Used by heterogeneous_proposal_card and the proposals review page.
 */

type ProposalType =
  | "create_note"
  | "update_note"
  | "append_note"
  | "replace_note"
  | "update_file"
  | "create_skill"
  | "update_skill"
  | "create_agent"
  | "update_agent";

interface ProposalTargetSummaryProps {
  proposalType: ProposalType;
  /** Name of the target object (note title, file/skill/agent name). */
  targetName?: string | null;
  /** Folder name for create_note proposals. */
  targetFolderName?: string | null;
  /** Source format for file/skill/agent proposals. */
  canonicalFormat?: string | null;
  /** Whether the target is a workspace-reusable object. */
  isReusable?: boolean;
  className?: string;
}

const PROPOSAL_CONFIG: Record<ProposalType, {
  objectType: string;
  actionLabel: string;
  actionClass: string;
  icon: React.ComponentType<{ className?: string }>;
  isDestructive?: boolean;
}> = {
  create_note: {
    objectType: "Note",
    actionLabel: "Create",
    actionClass: "text-foreground",
    icon: FileText,
  },
  update_note: {
    objectType: "Note",
    actionLabel: "Update",
    actionClass: "text-foreground",
    icon: FileText,
  },
  append_note: {
    objectType: "Note",
    actionLabel: "Append to",
    actionClass: "text-foreground",
    icon: FileText,
  },
  replace_note: {
    objectType: "Note",
    actionLabel: "Replace",
    actionClass: "text-destructive",
    icon: FileText,
    isDestructive: true,
  },
  update_file: {
    objectType: "File",
    actionLabel: "Update",
    actionClass: "text-foreground",
    icon: FileCode,
  },
  create_skill: {
    objectType: "Skill",
    actionLabel: "Create",
    actionClass: "text-foreground",
    icon: Zap,
  },
  update_skill: {
    objectType: "Skill",
    actionLabel: "Update",
    actionClass: "text-foreground",
    icon: Zap,
  },
  create_agent: {
    objectType: "Agent",
    actionLabel: "Create",
    actionClass: "text-foreground",
    icon: Bot,
  },
  update_agent: {
    objectType: "Agent",
    actionLabel: "Update",
    actionClass: "text-foreground",
    icon: Bot,
  },
};

export function ProposalTargetSummary({
  proposalType,
  targetName,
  targetFolderName,
  canonicalFormat,
  isReusable = false,
  className,
}: ProposalTargetSummaryProps) {
  const config = PROPOSAL_CONFIG[proposalType];
  const Icon = config.icon;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      {/* Action label */}
      <span className={cn("font-medium", config.actionClass)}>
        {config.actionLabel}
      </span>

      {/* Object type with icon */}
      <span className="flex items-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{config.objectType}</span>
      </span>

      {/* Target name */}
      {targetName && (
        <>
          <ArrowRight className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
          <span className="font-medium text-foreground truncate max-w-[200px]" title={targetName}>
            {targetName}
          </span>
        </>
      )}

      {/* Folder target for create_note */}
      {!targetName && targetFolderName && proposalType === "create_note" && (
        <>
          <ArrowRight className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
          <span className="flex items-center gap-1 text-muted-foreground">
            <FolderOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{targetFolderName}</span>
          </span>
        </>
      )}

      {/* Format */}
      {canonicalFormat && (
        <span className="rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {canonicalFormat}
        </span>
      )}

      {/* Reusable badge */}
      {isReusable && (
        <span className="rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          workspace shared
        </span>
      )}

      {/* Destructive warning */}
      {config.isDestructive && (
        <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
          destructive
        </span>
      )}
    </div>
  );
}
