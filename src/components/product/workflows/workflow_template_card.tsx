"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { createWorkflowFromTemplateAction } from "@/app/app/workflows/actions";
import type { WorkflowNodeType } from "@/server/domain/types/workflow";
import type { WorkflowTemplate } from "@/server/domain/workflow_templates";

// Mirror of `NODE_TYPE_META` in workflow_canvas so the gallery chips match the
// canvas legend without pulling in ReactFlow on this page.
const NODE_TYPE_META: Record<
  WorkflowNodeType,
  { label: string; icon: string; color: string }
> = {
  start: {
    label: "Start",
    icon: "▶",
    color: "bg-emerald-500/10 border-emerald-500/40 text-emerald-700",
  },
  subagent: {
    label: "Sub-agent",
    icon: "🤖",
    color: "bg-brand-500/10 border-brand-500/40 text-brand-700",
  },
  web_search: {
    label: "Web Search",
    icon: "🔍",
    color: "bg-blue-500/10 border-blue-500/40 text-blue-700",
  },
  web_fetch: {
    label: "Web Fetch",
    icon: "🌐",
    color: "bg-sky-500/10 border-sky-500/40 text-sky-700",
  },
  transform: {
    label: "Transform",
    icon: "⚡",
    color: "bg-amber-500/10 border-amber-500/40 text-amber-700",
  },
  condition: {
    label: "Condition",
    icon: "◇",
    color: "bg-orange-500/10 border-orange-500/40 text-orange-700",
  },
  merge: {
    label: "Merge",
    icon: "⬡",
    color: "bg-pink-500/10 border-pink-500/40 text-pink-700",
  },
  end: {
    label: "End",
    icon: "⏹",
    color: "bg-rose-500/10 border-rose-500/40 text-rose-700",
  },
};

const CATEGORY_LABEL: Record<WorkflowTemplate["category"], string> = {
  research: "Research",
  content: "Content",
  monitoring: "Monitoring",
  automation: "Automation",
};

interface WorkflowTemplateCardProps {
  template: WorkflowTemplate;
}

export function WorkflowTemplateCard({ template }: WorkflowTemplateCardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unique, stable-ordered list of node types used in the template — these
  // drive the colour-chip row on the card.
  const nodeTypes: WorkflowNodeType[] = [];
  const seen = new Set<WorkflowNodeType>();
  for (const n of template.graph.nodes) {
    if (!seen.has(n.node_type)) {
      seen.add(n.node_type);
      nodeTypes.push(n.node_type);
    }
  }

  async function onUseTemplate() {
    setError(null);
    setPending(true);
    try {
      const result = await createWorkflowFromTemplateAction(template.id);
      if (result.ok) {
        router.push(`/app/workflows/${result.workflowId}/edit`);
        // Leave `pending` true so the button stays in its loading state
        // during the client-side navigation that follows.
        return;
      }
      setError(result.error);
      setPending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to use template");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20">
      {/* Header: icon + name + category pill */}
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-xl"
        >
          {template.icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {template.name}
          </h3>
          <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {CATEGORY_LABEL[template.category]}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">{template.description}</p>

      {/* Node chips */}
      <div className="flex flex-wrap gap-1">
        {nodeTypes.map((nt) => {
          const meta = NODE_TYPE_META[nt];
          return (
            <span
              key={nt}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                meta.color
              )}
            >
              <span aria-hidden="true">{meta.icon}</span>
              {meta.label}
            </span>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <p className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-400">
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {/* Button */}
      <div className="mt-auto flex justify-end">
        <button
          type="button"
          onClick={onUseTemplate}
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background",
            "transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Use template
        </button>
      </div>
    </div>
  );
}
