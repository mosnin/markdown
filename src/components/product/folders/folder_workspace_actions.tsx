"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameFolderAction, createNoteAction } from "@/app/app/boxes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function FolderWorkspaceActions({
  folderId,
  boxId,
  initialName,
}: {
  folderId: string;
  boxId: string;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function renameFolder() {
    setError(null);
    startTransition(async () => {
      const result = await renameFolderAction(folderId, boxId, name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function createNoteInFolder() {
    const trimmed = newNoteTitle.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await createNoteAction(boxId, trimmed, folderId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNewNoteTitle("");
      router.push(`/app/notes/${result.data.id}`);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Folder actions</h2>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Rename folder</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isPending} />
        </div>
        <Button size="sm" onClick={renameFolder} disabled={isPending || !name.trim()}>
          Save
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Create note in this folder</label>
          <Input
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            placeholder="Untitled note"
            disabled={isPending}
          />
        </div>
        <Button size="sm" onClick={createNoteInFolder} disabled={isPending || !newNoteTitle.trim()}>
          Create note
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

