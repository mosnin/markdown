"use client";

import { useState } from "react";
import { List, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { KnowledgeGraphList } from "@/components/product/knowledge_graph_list";
import { KnowledgeGraphVisual, type EntityNode, type EntityEdgeLink } from "@/components/product/knowledge_graph_visual";

interface KnowledgeGraphTabsProps {
  entities: Array<EntityNode & { description: string | null; last_seen_at: string }>;
  edges: EntityEdgeLink[];
}

export function KnowledgeGraphTabs({ entities, edges }: KnowledgeGraphTabsProps) {
  const [tab, setTab] = useState<"list" | "visual">("list");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 flex items-center gap-0.5">
        {([
          { id: "list" as const, icon: List, label: "List" },
          { id: "visual" as const, icon: Network, label: "Visual" },
        ]).map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
              tab === item.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "list" ? (
          <div className="h-full overflow-y-auto">
            <KnowledgeGraphList entities={entities} />
          </div>
        ) : (
          <KnowledgeGraphVisual entities={entities} edges={edges} />
        )}
      </div>
    </div>
  );
}
