"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { importWorkspaceAction, type ActionResult } from "./actions";
import { type WorkspaceImportResult } from "@/server/domain/types/workspace_export";

export function ExportManager() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [collisionMode, setCollisionMode] = useState<"skip" | "overwrite">("skip");
  const [importResult, setImportResult] = useState<ActionResult<WorkspaceImportResult> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/v1/workspace_export");
      if (!res.ok) {
        alert("Export failed: " + (await res.text()));
        return;
      }
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="(.+)"/);
      const filename = match?.[1] ?? "workspace-export.json";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setImportResult({ ok: false, error: "Import file exceeds the 50 MB size limit" });
      return;
    }

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const result = await importWorkspaceAction(text, collisionMode);
      setImportResult(result);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="text-base font-semibold">Export workspace</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Download all boxes, notes, files, skills, agents, and links as a JSON file.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="px-6 py-4">
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting..." : "Export workspace"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-6 pt-6 pb-4">
          <CardTitle className="text-base font-semibold">Import workspace</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Upload a workspace export JSON file to import content into this workspace.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-4 px-6 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Collision mode
            </label>
            <select
              value={collisionMode}
              onChange={(e) => setCollisionMode(e.target.value as "skip" | "overwrite")}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="skip">Skip existing</option>
              <option value="overwrite">Overwrite existing</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              JSON file
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="block text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-4 file:py-2 file:text-sm file:font-medium"
            />
          </div>

          <Button onClick={handleImport} disabled={importing} variant="outline">
            {importing ? "Importing..." : "Import"}
          </Button>

          {importResult && (
            <div className="mt-4 rounded-md border border-border p-4 text-sm">
              {importResult.ok ? (
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Import complete</p>
                  <p>Boxes: {importResult.data.boxes.created} created, {importResult.data.boxes.skipped} skipped, {importResult.data.boxes.overwritten} overwritten</p>
                  <p>Folders: {importResult.data.folders.created} created, {importResult.data.folders.skipped} skipped</p>
                  <p>Notes: {importResult.data.notes.created} created, {importResult.data.notes.skipped} skipped, {importResult.data.notes.overwritten} overwritten</p>
                  <p>Files: {importResult.data.files.created} created, {importResult.data.files.skipped} skipped</p>
                  <p>Skills: {importResult.data.skills.created} created, {importResult.data.skills.skipped} skipped</p>
                  <p>Agents: {importResult.data.agents.created} created, {importResult.data.agents.skipped} skipped</p>
                  <p>Note links: {importResult.data.note_links.created} created, {importResult.data.note_links.skipped} skipped</p>
                  <p>Object links: {importResult.data.object_links.created} created, {importResult.data.object_links.skipped} skipped</p>
                  {importResult.data.warnings.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium text-amber-600">Warnings:</p>
                      {importResult.data.warnings.map((w, i) => (
                        <p key={i} className="text-muted-foreground">{w}</p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-destructive">{importResult.error}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
