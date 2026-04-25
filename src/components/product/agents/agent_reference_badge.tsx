import { cn } from "@/lib/utils";

interface AgentReferenceBadgeProps {
  isReusable: boolean;
  isAttachment?: boolean;
  className?: string;
}

/**
 * Badge communicating whether an Agent is:
 * - A workspace-level reusable Agent (is_reusable=true, not in a box)
 * - An attached reusable reference in a box context (is_reusable=true, is_attachment=true)
 * - A box-local Agent (is_reusable=false) → renders nothing
 */
export function AgentReferenceBadge({
  isReusable,
  isAttachment = false,
  className,
}: AgentReferenceBadgeProps) {
  if (!isReusable) return null;

  if (isAttachment) {
    return (
      <span
        title="This is a workspace-level reusable agent attached by reference"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30",
          "px-2 py-0.5 text-[10px] font-medium text-muted-foreground/70",
          className
        )}
      >
        <span aria-hidden="true">↗</span>
        Reference
      </span>
    );
  }

  return (
    <span
      title="This agent is stored at workspace level and can be attached into any box"
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-2.5 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      Reusable
    </span>
  );
}
