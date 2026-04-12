"use client";

import { useState } from "react";
import { Download, FileText, Folder, Package, Layers, Zap, Bot, File as FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  exportNoteAction,
  exportFolderAction,
  exportBoxAction,
  exportBundleAction,
  exportSkillAction,
  exportAgentAction,
  exportFileAction,
} from "@/app/app/import_export/actions";
import { type ExportMode } from "@/server/domain/types/import_export";

// ─── Download helper ──────────────────────────────────────────────────────────

/**
 * Trigger a browser download from a signed URL.
 * Uses a temporary anchor element — works in all modern browsers.
 * The signed URL already contains Content-Disposition: attachment so the
 * browser will save rather than navigate to the file.
 */
function triggerSignedDownload(signedUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = signedUrl;
  a.download = filename;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
          {loading ? "Preparing download…" : label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

// ─── Note export menu ─────────────────────────────────────────────────────────

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
        triggerSignedDownload(result.data.signed_url, result.data.filename);
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
        aria-haspopup="menu"
        aria-expanded={open}
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
          <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-md">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Export &quot;{noteTitle}&quot;
              </p>
            </div>
            <div className="p-1.5">
              <ExportMenuItem
                icon={<FileText className="h-4 w-4" />}
                label="Export note"
                description="Markdown file + export manifest with note metadata — signed link valid 1 hour"
                onClick={() => handleExport("note")}
                loading={loading === "note"}
              />
              <ExportMenuItem
                icon={<Layers className="h-4 w-4" />}
                label="Export context bundle"
                description="Note + linked context + guide note if assigned + README — signed link valid 1 hour"
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

// ─── Box export menu ──────────────────────────────────────────────────────────

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
        triggerSignedDownload(result.data.signed_url, result.data.filename);
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
        aria-haspopup="menu"
        aria-expanded={open}
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
          <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-md">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Export &quot;{boxName}&quot;
              </p>
            </div>
            <div className="p-1.5">
              <ExportMenuItem
                icon={<Package className="h-4 w-4" />}
                label={`Export box "${boxName}"`}
                description="Full box: notes, files, skills, agents, folders, semantic links, and manifest — signed link valid 1 hour"
                onClick={() => handleExport("box")}
                loading={loading === "box"}
              />
              {folderId && folderName && (
                <ExportMenuItem
                  icon={<Folder className="h-4 w-4" />}
                  label={`Export folder "${folderName}"`}
                  description="This folder with all descendants: notes, files, skills, and agents — signed link valid 1 hour"
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

// ─── Skill export menu ────────────────────────────────────────────────────────

export function SkillExportMenu({
  skillId,
  skillName,
}: {
  skillId: string;
  skillName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<ExportMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(mode: ExportMode) {
    setLoading(mode);
    setError(null);
    try {
      const result = await exportSkillAction(skillId, mode);
      if (result.ok) {
        triggerSignedDownload(result.data.signed_url, result.data.filename);
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
        onClick={() => { setOpen((o) => !o); setError(null); }}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        )}
        aria-label="Export skill"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-md">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Export &quot;{skillName}&quot;
              </p>
            </div>
            <div className="p-1.5">
              <ExportMenuItem
                icon={<FileText className="h-4 w-4" />}
                label="Canonical source only"
                description="Just the canonical editable source file — no child files, no manifest, no zip"
                onClick={() => handleExport("canonical_source")}
                loading={loading === "canonical_source"}
              />
              <ExportMenuItem
                icon={<Zap className="h-4 w-4" />}
                label="Full package (zip + manifest)"
                description="Canonical source + all child files and nested folders + manifest.json for round-trip import"
                onClick={() => handleExport("packaged")}
                loading={loading === "packaged"}
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

// ─── Agent export menu ────────────────────────────────────────────────────────

export function AgentExportMenu({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<ExportMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(mode: ExportMode) {
    setLoading(mode);
    setError(null);
    try {
      const result = await exportAgentAction(agentId, mode);
      if (result.ok) {
        triggerSignedDownload(result.data.signed_url, result.data.filename);
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
        onClick={() => { setOpen((o) => !o); setError(null); }}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        )}
        aria-label="Export agent"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-md">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Export &quot;{agentName}&quot;
              </p>
            </div>
            <div className="p-1.5">
              <ExportMenuItem
                icon={<FileText className="h-4 w-4" />}
                label="Canonical source only"
                description="Just the canonical editable source file — no child files, no manifest, no zip"
                onClick={() => handleExport("canonical_source")}
                loading={loading === "canonical_source"}
              />
              <ExportMenuItem
                icon={<Bot className="h-4 w-4" />}
                label="Full package (zip + manifest)"
                description="Canonical source + child files + nested folders + referenced Skills metadata + manifest.json"
                onClick={() => handleExport("packaged")}
                loading={loading === "packaged"}
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

// ─── File export menu ─────────────────────────────────────────────────────────

export function FileExportMenu({
  fileId,
  fileName,
}: {
  fileId: string;
  fileName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const result = await exportFileAction(fileId);
      if (result.ok) {
        triggerSignedDownload(result.data.signed_url, result.data.filename);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        aria-label={`Export ${fileName}`}
      >
        <Download className="h-3.5 w-3.5" />
        {loading ? "Preparing…" : "Export"}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
