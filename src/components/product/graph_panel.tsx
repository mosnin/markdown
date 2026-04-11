import { AlertTriangle, Bot, File, FileText, Folder, Share2, Zap } from "lucide-react";
import { type BoxOverview } from "@/server/services/overview_service";
import { BoxGraphView } from "./box_graph_view";

// ─── Graph panel ──────────────────────────────────────────────────────────────

/**
 * GraphPanel — server component wrapper for the box graph tab.
 *
 * Renders summary stats and the truncation warning (static), then
 * delegates the interactive graph visualization to BoxGraphView.
 */
export function GraphPanel({ overview }: { overview: BoxOverview }) {
  const { truncated, folderCount, noteCount, fileCount, skillCount, agentCount, edgeCount } = overview;

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
        {(fileCount ?? 0) > 0 && (
          <span className="flex items-center gap-1.5">
            <File className="h-3.5 w-3.5" aria-hidden="true" />
            {fileCount} file{fileCount !== 1 ? "s" : ""}
          </span>
        )}
        {(skillCount ?? 0) > 0 && (
          <span className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            {skillCount} skill{skillCount !== 1 ? "s" : ""}
          </span>
        )}
        {(agentCount ?? 0) > 0 && (
          <span className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            {agentCount} agent{agentCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          {edgeCount} link{edgeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Truncation warning */}
      {truncated && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50/50 px-3 py-2 dark:border-amber-600/30 dark:bg-amber-900/10">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500"
            aria-hidden="true"
          />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This box exceeds the display limit (1&nbsp;000 nodes / 2&nbsp;000 edges).
            Only the first portion is shown.
          </p>
        </div>
      )}

      {/* Interactive graph */}
      <BoxGraphView overview={overview} />
    </div>
  );
}
