"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertTriangle, CheckCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { importWorkspaceLevelPackageAction } from "@/app/app/import_export/actions";
import { type CollisionMode, type ImportSummaryReport } from "@/server/domain/types/import_export";

// ─── Mini summary ─────────────────────────────────────────────────────────────

function MiniSummary({ report }: { report: ImportSummaryReport }) {
  const { created_counts, warnings } = report;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
        <p className="text-sm font-medium text-foreground">Import complete</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {created_counts.agents > 0 && (
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{created_counts.agents}</span> agent{created_counts.agents !== 1 ? "s" : ""} created
          </span>
        )}
        {created_counts.agents === 0 && (
          <span className="text-xs text-muted-foreground">No new agents created</span>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50/50 px-2.5 py-2 dark:border-amber-700/30 dark:bg-amber-900/10">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex flex-col gap-0.5">
            {warnings.slice(0, 3).map((w, i) => (
              <p key={i} className="text-xs text-amber-600/80 dark:text-amber-400/80">{w.message}</p>
            ))}
            {warnings.length > 3 && (
              <p className="text-xs text-amber-600/60 dark:text-amber-400/60">+{warnings.length - 3} more warnings</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AgentImportDialog ────────────────────────────────────────────────────────

interface AgentImportDialogProps {
  onClose: () => void;
}

/**
 * Dialog for importing an agent package into the workspace library.
 * Accepts a .zip package (v1.1 manifest with agent entries).
 */
export function AgentImportDialog({ onClose }: AgentImportDialogProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [collisionMode, setCollisionMode] = useState<CollisionMode>("create_copy");
  const [report, setReport] = useState<ImportSummaryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    if (f) { setFile(f); setError(null); setReport(null); }
  }

  function handleImport() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("collision_mode", collisionMode);
      const result = await importWorkspaceLevelPackageAction(formData);
      if (result.ok) {
        setReport(result.data);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Import agent package</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Import a packaged .zip into the workspace agent library
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!report ? (
          <>
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors",
                file ? "border-border bg-muted/20" : "border-border hover:border-muted-foreground/40 hover:bg-muted/10"
              )}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Drop a .zip package, or click to select</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Max 25 MB</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileChange} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                If IDs already exist
              </label>
              <div className="flex gap-2">
                {(["create_copy", "replace_by_id", "remap_ids_and_import"] as CollisionMode[]).map((mode) => (
                  <label
                    key={mode}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors flex-1 justify-center",
                      collisionMode === mode ? "border-foreground/30 bg-muted/30 text-foreground" : "border-border text-muted-foreground hover:bg-muted/10"
                    )}
                  >
                    <input type="radio" name="agent_collision_mode" value={mode} checked={collisionMode === mode} onChange={() => setCollisionMode(mode)} className="sr-only" />
                    {mode === "create_copy" ? "Copy" : mode === "replace_by_id" ? "Replace" : "Remap"}
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40">
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
            <MiniSummary report={report} />
            <div className="flex justify-end">
              <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Trigger button ───────────────────────────────────────────────────────────

export function AgentImportTrigger() {
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
      {open && <AgentImportDialog onClose={() => setOpen(false)} />}
    </>
  );
}
