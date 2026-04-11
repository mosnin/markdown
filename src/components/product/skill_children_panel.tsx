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
}: {
  skillId: string;
  childrenItems: ChildItem[];
}) {
  const router = useRouter();
  const [folderOpen, setFolderOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileFormat, setFileFormat] = useState<SkillAgentFormat>("markdown");
  const [isPending, start] = useTransition();

  function createFolder() {
    if (!folderName.trim()) return;
    start(async () => {
      const res = await createSkillChildFolderAction(skillId, folderName.trim());
      if (res.ok) {
        setFolderOpen(false);
        setFolderName("");
        router.refresh();
      }
    });
  }

  function createFile() {
    if (!fileName.trim()) return;
    start(async () => {
      const res = await createSkillChildFileAction(skillId, { filename: fileName.trim(), canonicalFormat: fileFormat });
      if (res.ok) {
        setFileOpen(false);
        setFileName("");
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Children</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}><FolderPlus className="h-3.5 w-3.5" />Folder</Button>
          <Button size="sm" variant="outline" onClick={() => setFileOpen(true)}><Plus className="h-3.5 w-3.5" />File</Button>
        </div>
      </div>
      {childrenItems.length === 0 ? (
        <p className="text-xs text-muted-foreground">No child files or folders yet. Create one to build this skill structure.</p>
      ) : (
        <ul className="space-y-1">
          {childrenItems.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40">
                {item.type === "folder" ? <Folder className="h-4 w-4" /> : <File className="h-4 w-4" />}
                <span>{item.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New child folder</DialogTitle></DialogHeader>
          <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Folder name" />
          <DialogFooter showCloseButton>
            <Button size="sm" onClick={createFolder} disabled={isPending || !folderName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fileOpen} onOpenChange={setFileOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New child file</DialogTitle></DialogHeader>
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="File name" />
          <select
            value={fileFormat}
            onChange={(e) => setFileFormat(e.target.value as SkillAgentFormat)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SKILL_AGENT_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <DialogFooter showCloseButton>
            <Button size="sm" onClick={createFile} disabled={isPending || !fileName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
