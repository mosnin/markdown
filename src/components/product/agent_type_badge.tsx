import { cn } from "@/lib/utils";
import { type AgentType } from "@/server/domain/constants/object_constants";

// ─── Label map ────────────────────────────────────────────────────────────────

const AGENT_TYPE_LABEL: Record<AgentType | string, string> = {
  reasoning: "Reasoning",
  coding: "Coding",
  research: "Research",
  planning: "Planning",
  retrieval: "Retrieval",
  synthesis: "Synthesis",
  orchestration: "Orchestration",
  custom: "Custom",
};

interface AgentTypeBadgeProps {
  agentType: AgentType | string | null | undefined;
  className?: string;
  /** Show as a subtle inline tag rather than prominent badge */
  subtle?: boolean;
}

/**
 * Compact badge displaying the agent type taxonomy label.
 * Used in agent cards, headers, and the overview panel.
 */
export function AgentTypeBadge({ agentType, className, subtle = false }: AgentTypeBadgeProps) {
  if (!agentType) return null;
  const label = AGENT_TYPE_LABEL[agentType] ?? agentType;

  if (subtle) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5",
          "text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
          className
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-2.5 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      {label}
    </span>
  );
}
