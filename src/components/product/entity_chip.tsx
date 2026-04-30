import Link from "next/link";
import { User, Briefcase, Lightbulb, Building2, Calendar, CheckCircle, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type EntityChipType = "person" | "project" | "concept" | "organization" | "event" | "decision" | "other";

const TYPE_ICONS: Record<EntityChipType, React.ElementType> = {
  person: User,
  project: Briefcase,
  concept: Lightbulb,
  organization: Building2,
  event: Calendar,
  decision: CheckCircle,
  other: HelpCircle,
};

const TYPE_COLORS: Record<EntityChipType, string> = {
  person:       "text-blue-600 bg-blue-500/10 border-blue-500/30 dark:text-blue-400",
  project:      "text-brand-600 bg-brand-500/10 border-brand-500/30 dark:text-brand-400",
  concept:      "text-amber-600 bg-amber-500/10 border-amber-500/30 dark:text-amber-400",
  organization: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30 dark:text-emerald-400",
  event:        "text-rose-600 bg-rose-500/10 border-rose-500/30 dark:text-rose-400",
  decision:     "text-indigo-600 bg-indigo-500/10 border-indigo-500/30 dark:text-indigo-400",
  other:        "text-muted-foreground bg-muted border-border",
};

interface EntityChipProps {
  id: string;
  name: string;
  type: EntityChipType;
  mentionCount?: number;
  interactive?: boolean;
  size?: "sm" | "md";
}

export function EntityChip({ id, name, type, mentionCount, interactive = true, size = "sm" }: EntityChipProps) {
  const Icon = TYPE_ICONS[type];
  const colorClass = TYPE_COLORS[type];

  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium transition-colors",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        colorClass,
        interactive && "hover:opacity-80"
      )}
    >
      <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} aria-hidden="true" />
      <span className="truncate max-w-[180px]">{name}</span>
      {typeof mentionCount === "number" && mentionCount > 0 && (
        <span className="text-muted-foreground/60 ml-0.5">·{mentionCount}</span>
      )}
    </span>
  );

  if (!interactive) return content;
  return <Link href={`/app/entities/${id}`}>{content}</Link>;
}
