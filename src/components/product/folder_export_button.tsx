"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportFolderAction } from "@/app/app/import_export/actions";

/**
 * FolderExportButton — exports a folder and its descendants as a zip package.
 *
 * Calls exportFolderAction which packages folder structure, notes, and links
 * into a signed download URL valid for 1 hour.
 */
export function FolderExportButton({
  folderId,
  folderName,
}: {
  folderId: string;
  folderName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const result = await exportFolderAction(folderId);
      if (result.ok) {
        const a = document.createElement("a");
        a.href = result.data.signed_url;
        a.download = result.data.filename;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleExport}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs",
          "text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        aria-label={`Export folder "${folderName}"`}
        title={`Export "${folderName}" with all notes, files, skills, and agents inside it`}
      >
        <Download className="h-3.5 w-3.5" />
        {loading ? "Exporting…" : "Export"}
      </button>
      {error && (
        <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-md border border-border bg-popover px-3 py-2 shadow-md">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
