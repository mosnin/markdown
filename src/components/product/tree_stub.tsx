import { type ReactNode } from "react";
import { ChevronRight, FileText, Folder, BookOpen, Package } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types matching the Context Store IA ────────────────────────────────────

type NodeType = "folder" | "note" | "guide" | "bundle";

interface TreeNode {
  id: string;
  label: string;
  type: NodeType;
  children?: TreeNode[];
}

// ─── Icons per node type ─────────────────────────────────────────────────────

const typeIcon: Record<NodeType, ReactNode> = {
  folder: <Folder className="h-3.5 w-3.5" />,
  note: <FileText className="h-3.5 w-3.5" />,
  guide: <BookOpen className="h-3.5 w-3.5" />,
  bundle: <Package className="h-3.5 w-3.5" />,
};

// ─── Tree node row ───────────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth = 0,
}: {
  node: TreeNode;
  depth?: number;
}) {
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer select-none items-center gap-1.5 rounded-md py-1 pr-2 text-sm",
          "text-muted-foreground transition-colors duration-150",
          "hover:bg-accent/60 hover:text-foreground"
        )}
        style={{
          // 2.5px padding-left per indent level, atop a 6px base.
          paddingLeft: `${0.375 + depth * 0.625}rem`,
        }}
      >
        {hasChildren ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <span className="text-muted-foreground">{typeIcon[node.type]}</span>
        <span className="truncate">{node.label}</span>
      </div>
      {hasChildren &&
        node.children!.map((child) => (
          <TreeNodeRow key={child.id} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

// ─── Stub prop types ─────────────────────────────────────────────────────────

interface TreeStubProps {
  /** Nodes to render — replaced with live data in a later prompt */
  nodes: TreeNode[];
  className?: string;
}

/**
 * Placeholder tree view for boxes and folders.
 * Renders static structure without expand/collapse state.
 * Wire up with real data and interaction in a later prompt.
 */
export function TreeStub({ nodes, className }: TreeStubProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {nodes.map((node) => (
        <TreeNodeRow key={node.id} node={node} />
      ))}
    </div>
  );
}

export type { TreeNode, NodeType };
