"use client";

import { useState } from "react";
import { Download, FileText, Folder, Package, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  exportNoteAction,
  exportFolderAction,
  exportBoxAction,
  exportBundleAction,
} from "@/app/app/import_export/actions";

// ─── Download helper ──────────────────────────────────────────────────────────

function triggerDownload(base64: string, filename: string, mimeType = "application/zip") {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Export menu item ─────────────────────────────────────────────────────────

interface ExportMenuItemProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  loading: boolean;
}

function ExportMenuItem({ icon, label, description, onClick, loading }: ExportMenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
        "hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed"
      )}
    >
      <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {loading ? "Exporting…" : label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

// ─── Note export button ───────────────────────────────────────────────────────

export function NoteExportMenu({
  noteId,
  noteTitle,
}: {
  noteId: string;
  noteTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(type: "note" | "bundle") {
    setLoading(type);
    setError(null);
    try {
      const result =
        type === "note"
          ? await exportNoteAction(noteId)
          : await exportBundleAction(noteId);

      if (result.ok) {
        triggerDownload(result.data.base64, result.data.filename);
        setOpen(false);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        )}
        aria-label="Export options"
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-md">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Export "{noteTitle}"
              </p>
            </div>
            <div className="p-1.5">
              <ExportMenuItem
                icon={<FileText className="h-4 w-4" />}
                label="Export note"
                description="Markdown + manifest.json"
                onClick={() => handleExport("note")}
                loading={loading === "note"}
              />
              <ExportMenuItem
                icon={<Layers className="h-4 w-4" />}
                label="Export context bundle"
                description="Bundle with linked notes + README"
                onClick={() => handleExport("bundle")}
                loading={loading === "bundle"}
              />
            </div>
            {error && (
              <div className="border-t border-border px-3 py-2">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Box export button ────────────────────────────────────────────────────────

export function BoxExportMenu({
  boxId,
  boxName,
  folderId,
  folderName,
}: {
  boxId: string;
  boxName: string;
  folderId?: string;
  folderName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(type: "box" | "folder") {
    setLoading(type);
    setError(null);
    try {
      const result =
        type === "box"
          ? await exportBoxAction(boxId)
          : await exportFolderAction(folderId!);

      if (result.ok) {
        triggerDownload(result.data.base64, result.data.filename);
        setOpen(false);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        )}
        aria-label="Export options"
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-md">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Export
              </p>
            </div>
            <div className="p-1.5">
              <ExportMenuItem
                icon={<Package className="h-4 w-4" />}
                label={`Export box "${boxName}"`}
                description="All notes, folders, and links"
                onClick={() => handleExport("box")}
                loading={loading === "box"}
              />
              {folderId && folderName && (
                <ExportMenuItem
                  icon={<Folder className="h-4 w-4" />}
                  label={`Export folder "${folderName}"`}
                  description="This folder and its descendants"
                  onClick={() => handleExport("folder")}
                  loading={loading === "folder"}
                />
              )}
            </div>
            {error && (
              <div className="border-t border-border px-3 py-2">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
