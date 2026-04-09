import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  FileText,
  Folder,
  Network,
  Package,
  Share2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type BoxOverview, type OverviewNode } from "@/server/services/overview_service";

// ─── Tree node ────────────────────────────────────────────────────────────────

function HierarchyNode({
  item,
  childMap,
  depth,
}: {
  item: OverviewNode;
  childMap: Map<string, OverviewNode[]>;
  depth: number;
}) {
  const children = childMap.get(item.id) ?? [];
  const indent = depth * 16;

  return (
    <>
      <div
        className="flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm hover:bg-muted/40"
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        {item.kind === "folder" ? (
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : item.noteKind === "guide" ? (
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : item.noteKind === "bundle" ? (
          <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}

        {item.kind === "note" ? (
          <Link
            href={`/app/notes/${item.id}`}
            className="flex-1 truncate text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
          >
            {item.label}
          </Link>
        ) : (
          <span className="flex-1 truncate font-medium text-foreground/80">{item.label}</span>
        )}

        {item.kind === "note" && item.noteKind && item.noteKind !== "note" && (
          <Badge
            variant="secondary"
            className="shrink-0 text-[10px] font-normal capitalize"
          >
            {item.noteKind}
          </Badge>
        )}
      </div>

      {children.map((child) => (
        <HierarchyNode
          key={child.id}
          item={child}
          childMap={childMap}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

// ─── Graph panel ──────────────────────────────────────────────────────────────

export function GraphPanel({ overview }: { overview: BoxOverview }) {
  const { nodes, edges, truncated, folderCount, noteCount, edgeCount } = overview;

  // Build child map for hierarchy rendering
  const rootItems = nodes.filter((n) => n.parentId === null);
  const childMap = new Map<string, OverviewNode[]>();
  for (const n of nodes) {
    if (n.parentId) {
      const arr = childMap.get(n.parentId) ?? [];
      arr.push(n);
      childMap.set(n.parentId, arr);
    }
  }

  // Note label map for edge display
  const nodeLabel = new Map(nodes.map((n) => [n.id, n.label]));

  return (
    <div className="flex flex-col gap-6">
      {/* Stats */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Folder className="h-3.5 w-3.5" aria-hidden="true" />
          {folderCount} folder{folderCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          {noteCount} note{noteCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1.5">
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          {edgeCount} link{edgeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Truncation warning */}
      {truncated && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50/50 px-3 py-2 dark:border-amber-600/30 dark:bg-amber-900/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden="true" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This box exceeds the display limit (1&nbsp;000 nodes / 2&nbsp;000 edges).
            Only the first portion is shown.
          </p>
        </div>
      )}

      {/* Structure section */}
      <section aria-labelledby="graph-structure-heading">
        <h3
          id="graph-structure-heading"
          className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          <Network className="h-3.5 w-3.5" aria-hidden="true" />
          Structure
        </h3>

        {nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No content yet</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {rootItems.map((item) => (
              <HierarchyNode
                key={item.id}
                item={item}
                childMap={childMap}
                depth={0}
              />
            ))}
          </div>
        )}
      </section>

      {/* Context relationships section */}
      {edges.length > 0 && (
        <section aria-labelledby="graph-relationships-heading">
          <h3
            id="graph-relationships-heading"
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            Context relationships
          </h3>

          <div className="flex flex-col gap-1.5">
            {edges.map((edge) => (
              <div
                key={edge.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-xs"
              >
                <Link
                  href={`/app/notes/${edge.sourceNoteId}`}
                  className="min-w-0 flex-1 truncate text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
                >
                  {nodeLabel.get(edge.sourceNoteId) ?? "Note"}
                </Link>
                <Badge
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap text-[10px] font-normal capitalize"
                >
                  {edge.relationshipType}
                </Badge>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                <Link
                  href={`/app/notes/${edge.targetNoteId}`}
                  className="min-w-0 flex-1 truncate text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
                >
                  {nodeLabel.get(edge.targetNoteId) ?? "Note"}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
