import { Bot, File, FileText, Folder, AlertTriangle, ArrowRight, Zap } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type BoxOverview, type OverviewNode } from "@/server/services/overview_service";

interface BoxOverviewPanelProps {
  overview: BoxOverview;
}

/**
 * Box overview panel — renders the hierarchy tree and inter-note link edges.
 *
 * Hierarchy is built from the flat node list at render time.
 * A truncation notice is shown when the 1000-node or 2000-edge hard limit was hit.
 */
export function BoxOverviewPanel({ overview }: BoxOverviewPanelProps) {
  const { nodes, edges, truncated, folderCount, noteCount, edgeCount } = overview;

  // ── Build folder tree ──────────────────────────────────────────────────────
  // Root-level items: parentId is null
  const rootItems = nodes.filter((n) => n.parentId === null);
  const childMap = new Map<string, typeof nodes>();
  for (const n of nodes) {
    if (n.parentId) {
      const arr = childMap.get(n.parentId) ?? [];
      arr.push(n);
      childMap.set(n.parentId, arr);
    }
  }

  // ── Note title map for edge display ───────────────────────────────────────
  const nodeLabel = new Map(nodes.map((n) => [n.id, n.label]));

  return (
    <div className="flex flex-col gap-6">
      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Folder className="h-3.5 w-3.5" />
          {folderCount} folder{folderCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" />
          {noteCount} note{noteCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <ArrowRight className="h-3.5 w-3.5" />
          {edgeCount} link{edgeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {truncated && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50/50 px-3 py-2 dark:border-amber-600/30 dark:bg-amber-900/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This box exceeds the display limit (1 000 nodes / 2 000 edges).
            Only the first portion is shown.
          </p>
        </div>
      )}

      {/* Hierarchy tree */}
      {nodes.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Hierarchy
          </h3>
          {rootItems.map((item) => (
            <TreeNode
              key={item.id}
              item={item}
              childMap={childMap}
              depth={0}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No notes or folders yet.</p>
      )}

      {/* Link edges */}
      {edges.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Note links
          </h3>
          <div className="flex flex-col gap-1">
            {edges.map((edge) => (
              <div
                key={edge.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
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
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <Link
                  href={`/app/notes/${edge.targetNoteId}`}
                  className="min-w-0 flex-1 truncate text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
                >
                  {nodeLabel.get(edge.targetNoteId) ?? "Note"}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TreeNode ─────────────────────────────────────────────────────────────────

function getOverviewNodeIcon(kind: string) {
  switch (kind) {
    case "folder": return Folder;
    case "file": return File;
    case "skill": return Zap;
    case "agent": return Bot;
    default: return FileText;
  }
}

function getOverviewNodeHref(kind: string, id: string): string | null {
  switch (kind) {
    case "note": return `/app/notes/${id}`;
    case "file": return `/app/files/${id}`;
    case "skill": return `/app/skills/${id}`;
    case "agent": return `/app/agents/${id}`;
    case "folder": return `/app/folders/${id}`;
    default: return null;
  }
}

function TreeNode({
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
  const Icon = getOverviewNodeIcon(item.kind);
  const href = getOverviewNodeHref(item.kind, item.id);

  return (
    <>
      <div
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted/50"
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {href ? (
          <Link
            href={href}
            className="flex-1 truncate text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
          >
            {item.label}
          </Link>
        ) : (
          <span className="flex-1 truncate text-foreground/80">{item.label}</span>
        )}
        {item.kind !== "folder" && (
          <Badge
            variant="secondary"
            className="shrink-0 text-[10px] font-normal capitalize"
          >
            {item.noteKind && item.noteKind !== "note" ? item.noteKind : item.kind}
          </Badge>
        )}
      </div>
      {children.map((child) => (
        <TreeNode
          key={child.id}
          item={child}
          childMap={childMap}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
