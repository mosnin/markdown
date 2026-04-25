"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { File, Folder, FolderPlus, Plus } from "lucide-react";
import { createSkillChildFileAction, createSkillChildFolderAction } from "@/app/app/skills/actions";
import { SKILL_AGENT_FORMATS, type SkillAgentFormat } from "@/server/domain/constants/object_constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ChildItem = { id: string; type: "file" | "folder"; name: string; href: string };

export function SkillChildrenPanel({
  skillId,
  childrenItems,
  canCreateFolders = true,
}: {
  skillId: string;
  childrenItems: ChildItem[];
  canCreateFolders?: boolean;
}) {
  const router = useRouter();
  const [folderOpen, setFolderOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileFormat, setFileFormat] = useState<SkillAgentFormat>("markdown");
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function createFolder() {
    if (!folderName.trim()) return;
    setError(null);
    start(async () => {
      const res = await createSkillChildFolderAction(skillId, folderName.trim());
      if (res.ok) {
        setFolderOpen(false);
        setFolderName("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function createFile() {
    if (!fileName.trim()) return;
    setError(null);
    start(async () => {
      const res = await createSkillChildFileAction(skillId, { filename: fileName.trim(), canonicalFormat: fileFormat });
      if (res.ok) {
        setFileOpen(false);
        setFileName("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const folders = childrenItems.filter((i) => i.type === "folder");
  const files = childrenItems.filter((i) => i.type === "file");

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Supporting files
          {childrenItems.length > 0 && (
            <span className="ml-1.5 font-normal text-muted-foreground/60">({childrenItems.length})</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {canCreateFolders && (
            <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
              <FolderPlus className="h-3.5 w-3.5" /> Folder
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setFileOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> File
          </Button>
        </div>
      </div>

      {childrenItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
          <File className="mx-auto h-6 w-6 text-muted-foreground/30 mb-2" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            No child files or folders yet. Add supporting files to build this skill&#39;s package structure.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {folders.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Folders</p>
              <ul className="space-y-0.5">
                {folders.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40">
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span>{item.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Files</p>
              <ul className="space-y-0.5">
                {files.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40">
                      <File className="h-4 w-4 text-muted-foreground" />
                      <span>{item.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Folder creation dialog */}
      <Dialog open={folderOpen} onOpenChange={(v) => { setFolderOpen(v); if (!v) { setFolderName(""); setError(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New child folder</DialogTitle></DialogHeader>
          <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Folder name" autoFocus />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter showCloseButton>
            <Button size="sm" onClick={createFolder} disabled={isPending || !folderName.trim()}>
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File creation dialog */}
      <Dialog open={fileOpen} onOpenChange={(v) => { setFileOpen(v); if (!v) { setFileName(""); setError(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New child file</DialogTitle></DialogHeader>
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="File name" autoFocus />
          <select
            value={fileFormat}
            onChange={(e) => setFileFormat(e.target.value as SkillAgentFormat)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SKILL_AGENT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter showCloseButton>
            <Button size="sm" onClick={createFile} disabled={isPending || !fileName.trim()}>
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
