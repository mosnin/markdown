"use client";

import { useState, useRef, useTransition } from "react";
import { Upload, AlertTriangle, CheckCircle, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { importPackageAction } from "@/app/app/import_export/actions";
import {
  type CollisionMode,
  type ImportSummaryReport,
  type ImportAction,
} from "@/server/domain/types/import_export";

// ─── Collision mode descriptions ──────────────────────────────────────────────

const COLLISION_MODE_INFO: Record<
  CollisionMode,
  { label: string; description: string }
> = {
  create_copy: {
    label: "Create copy",
    description:
      'Always create new objects. Colliding titles get a "-copy" suffix. Existing content is never overwritten.',
  },
  replace_by_id: {
    label: "Replace by ID",
    description:
      "Match by stable ID. Notes with matching IDs are updated in place with a new version. Unmatched objects are created.",
  },
  merge_metadata_only: {
    label: "Merge metadata only",
    description:
      "Never replaces markdown body. Merges summary, tags, and read_hint for matching notes. Body is always preserved.",
  },
  remap_ids_and_import: {
    label: "Remap IDs and import",
    description:
      "Generate new IDs for all colliding objects. Rewrites internal references. Original IDs are recorded for traceability.",
  },
};

// ─── Summary display ──────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: ImportAction["action"] }) {
  const colors: Record<ImportAction["action"], string> = {
    created: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    replaced: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    duplicated: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    remapped: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    skipped: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", colors[action])}>
      {action}
    </span>
  );
}

function SummaryPanel({ report }: { report: ImportSummaryReport }) {
  const [expanded, setExpanded] = useState(false);

  const totalCreated =
    report.created_counts.notes +
    report.created_counts.folders +
    report.created_counts.links;
  const totalReplaced =
    report.replaced_counts.notes + report.replaced_counts.folders;
  const totalSkipped =
    report.skipped_counts.notes +
    report.skipped_counts.folders +
    report.skipped_counts.links;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
        <p className="text-sm font-medium text-foreground">Import complete</p>
        <Badge variant="secondary" className="text-[10px] font-normal capitalize">
          {COLLISION_MODE_INFO[report.collision_mode].label}
        </Badge>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 gap-2">
        {totalCreated > 0 && (
          <div className="rounded border border-border bg-card px-2 py-1.5 text-center">
            <p className="text-lg font-semibold text-green-600 dark:text-green-400">{totalCreated}</p>
            <p className="text-[10px] text-muted-foreground">Created</p>
          </div>
        )}
        {totalReplaced > 0 && (
          <div className="rounded border border-border bg-card px-2 py-1.5 text-center">
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">{totalReplaced}</p>
            <p className="text-[10px] text-muted-foreground">Replaced</p>
          </div>
        )}
        {totalSkipped > 0 && (
          <div className="rounded border border-border bg-card px-2 py-1.5 text-center">
            <p className="text-lg font-semibold text-muted-foreground">{totalSkipped}</p>
            <p className="text-[10px] text-muted-foreground">Skipped</p>
          </div>
        )}
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded border border-amber-200 bg-amber-50/50 px-3 py-2.5 dark:border-amber-700/30 dark:bg-amber-900/10">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {report.warnings.length} warning{report.warnings.length !== 1 ? "s" : ""}
            </p>
          </div>
          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600/80 dark:text-amber-400/80">
              {w.message}
              {w.subject ? <span className="font-mono ml-1 text-[10px]">({w.subject})</span> : null}
            </p>
          ))}
        </div>
      )}

      {/* Action log (collapsed by default) */}
      {report.actions.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            />
            {expanded ? "Hide" : "Show"} action log ({report.actions.length})
          </button>
          {expanded && (
            <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {report.actions.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <ActionBadge action={a.action} />
                  <span className="capitalize text-muted-foreground">{a.object_type}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground/70 font-mono text-[10px]">
                    {a.final_path ?? a.incoming_path ?? a.final_id ?? a.incoming_id ?? "—"}
                  </span>
                  {a.reason && (
                    <span className="shrink-0 text-muted-foreground/60 italic">{a.reason}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Import dialog ────────────────────────────────────────────────────────────

interface ImportDialogProps {
  boxId: string;
  folders: Array<{ id: string; name: string; path_cache: string }>;
  onClose: () => void;
}

export function ImportDialog({ boxId, folders, onClose }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [collisionMode, setCollisionMode] = useState<CollisionMode>("create_copy");
  const [targetFolderId, setTargetFolderId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportSummaryReport | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError(null);
    setReport(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) {
      setFile(f);
      setError(null);
      setReport(null);
    }
  }

  function handleImport() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("box_id", boxId);
      formData.set("collision_mode", collisionMode);
      if (targetFolderId) formData.set("target_folder_id", targetFolderId);

      const result = await importPackageAction(formData);
      if (result.ok) {
        setReport(result.data);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Import</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a .md file or .zip package
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!report ? (
          <>
            {/* File drop zone */}
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors",
                file
                  ? "border-border bg-muted/20"
                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/10"
              )}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    Drop a .md or .zip file, or click to select
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Max 25 MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.zip"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Collision mode */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Collision mode
              </label>
              <div className="flex flex-col gap-2">
                {(Object.keys(COLLISION_MODE_INFO) as CollisionMode[]).map((mode) => (
                  <label
                    key={mode}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                      collisionMode === mode
                        ? "border-foreground/30 bg-muted/30"
                        : "border-border hover:bg-muted/10"
                    )}
                  >
                    <input
                      type="radio"
                      name="collision_mode"
                      value={mode}
                      checked={collisionMode === mode}
                      onChange={() => setCollisionMode(mode)}
                      className="mt-0.5 shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {COLLISION_MODE_INFO[mode].label}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {COLLISION_MODE_INFO[mode].description}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Target folder */}
            {folders.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Import into folder (optional)
                </label>
                <select
                  value={targetFolderId}
                  onChange={(e) => setTargetFolderId(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Box root</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.path_cache}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!file || isPending}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  "bg-foreground text-background hover:bg-foreground/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {isPending ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        ) : (
          <>
            <SummaryPanel report={report} />
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Import trigger button ────────────────────────────────────────────────────

export function ImportTriggerButton({
  boxId,
  folders,
}: {
  boxId: string;
  folders: Array<{ id: string; name: string; path_cache: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        )}
      >
        <Upload className="h-3.5 w-3.5" />
        Import
      </button>
      {open && (
        <ImportDialog
          boxId={boxId}
          folders={folders}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
