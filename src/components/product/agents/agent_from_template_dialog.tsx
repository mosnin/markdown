"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Bot, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_TEMPLATES, type AgentTemplate } from "@/lib/templates/agent_templates";
import { createReusableAgentAction } from "@/app/app/agents/actions";
import { AgentTypeBadge } from "@/components/product/agents/agent_type_badge";

export function AgentFromTemplateDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const router = useRouter();

  function handleSelect(template: AgentTemplate) {
    if (pending) return;
    setSelectedId(template.id);
    startTransition(async () => {
      const result = await createReusableAgentAction({
        name: template.name,
        description: template.description,
        agentType: template.agent_type,
        tags: template.tags,
        systemPrompt: template.system_prompt,
        initialContent: template.source_content,
        canonicalFormat: "markdown",
      });
      if (result.ok) {
        setOpen(false);
        router.push(`/app/agents/${result.data.id}`);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        From template
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold text-foreground">Agent templates</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick a starting point — you can edit everything after creation.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 max-h-[60vh] overflow-y-auto">
              {AGENT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleSelect(template)}
                  disabled={pending}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4 text-left",
                    "transition-colors hover:bg-accent/40 hover:border-brand-500/30",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                    "disabled:opacity-50",
                    selectedId === template.id && pending && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 text-sm font-medium text-foreground truncate">
                      {template.name}
                    </span>
                    <AgentTypeBadge agentType={template.agent_type} subtle className="shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {template.description}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {template.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                    <ChevronRight
                      className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
                      aria-hidden="true"
                    />
                  </div>
                </button>
              ))}
            </div>
            <div className="border-t border-border px-5 py-3 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
