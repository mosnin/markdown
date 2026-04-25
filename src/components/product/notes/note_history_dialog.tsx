"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  listNoteVersionsAction,
  getNoteVersionDetailAction,
  restoreNoteVersionAction,
  type VersionListItem,
  type VersionDetail,
} from "@/app/app/notes/history_actions";
import { formatAbsoluteDate, formatRelativeDate } from "@/lib/format_date";

interface NoteHistoryDialogProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Version history browser for a single note.
 *
 * Layout: left rail lists versions (newest first), right pane previews
 * the selected version's full markdown content. A "Restore" button in
 * the preview header calls `restoreNoteVersionAction`, which appends a
 * new version matching the selected one — the restore itself is
 * therefore reversible and appears in history.
 *
 * Hydration: relative timestamps are computed against a `now` value
 * captured on dialog open via useMemo so server-rendered and
 * client-rendered strings stay identical during the first paint.
 */
export function NoteHistoryDialog({
  noteId,
  open,
  onOpenChange,
}: NoteHistoryDialogProps) {
  const [versions, setVersions] = useState<VersionListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Captured once per "open" so relative labels ("Today", "3 days ago")
  // remain stable while the dialog is mounted.
  const nowIso = useMemo(
    () => new Date().toISOString(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );

  useEffect(() => {
    if (!open) {
      // Reset local state between opens so stale data from one note
      // doesn't flash when the dialog is reopened for another.
      setVersions(null);
      setSelectedId(null);
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listNoteVersionsAction(noteId).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setVersions(r.data);
        if (r.data[0]) setSelectedId(r.data[0].id);
      } else {
        setError(r.error);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, noteId]);

  useEffect(() => {
    if (!open || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getNoteVersionDetailAction(noteId, selectedId).then((r) => {
      if (cancelled) return;
      if (r.ok) setDetail(r.data);
      else setError(r.error);
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, noteId, selectedId]);

  async function handleRestore() {
    if (!selectedId || restoring) return;
    setRestoring(true);
    setError(null);
    const r = await restoreNoteVersionAction(noteId, selectedId);
    setRestoring(false);
    if (r.ok) {
      onOpenChange(false);
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  const selectedVersion = versions?.find((v) => v.id === selectedId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" aria-hidden="true" />
            Version history
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <Spinner />
          </div>
        ) : error && !versions ? (
          <p className="p-4 text-sm text-red-500">{error}</p>
        ) : !versions || versions.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No versions yet.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 divide-x divide-border">
            {/* ── Version list ─────────────────────────────────────── */}
            <ScrollArea className="w-60 shrink-0">
              <div className="flex flex-col gap-0.5 p-2">
                {versions.map((v) => {
                  const isSelected = selectedId === v.id;
                  return (
                    <button
                      type="button"
                      key={v.id}
                      onClick={() => setSelectedId(v.id)}
                      className={cn(
                        "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground/80 hover:bg-muted"
                      )}
                    >
                      <span className="font-medium">v{v.version_number}</span>
                      <span className="text-muted-foreground">
                        {formatRelativeDate(v.created_at, nowIso)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>

            {/* ── Preview pane ─────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {detail?.title ?? selectedVersion?.title ?? ""}
                  </p>
                  {selectedVersion && (
                    <p className="text-xs text-muted-foreground">
                      v{selectedVersion.version_number}
                      {" · "}
                      {formatAbsoluteDate(selectedVersion.created_at)}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleRestore()}
                  disabled={restoring || !selectedId}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {restoring ? "Restoring…" : "Restore"}
                </Button>
              </div>

              {error && (
                <p className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-500">
                  {error}
                </p>
              )}

              <ScrollArea className="flex-1">
                {detailLoading && !detail ? (
                  <div className="flex items-center justify-center p-8">
                    <Spinner />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-foreground/80">
                    {detail?.markdown_content ?? ""}
                  </pre>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
