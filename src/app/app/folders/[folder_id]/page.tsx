import Link from "next/link";
import { notFound } from "next/navigation";
import { Folder } from "lucide-react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getFolderById, listFoldersByBox } from "@/server/repositories/folder_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { listFilesByBox } from "@/server/repositories/file_repository";
import { listSkillsByBox } from "@/server/repositories/skill_repository";
import { listAgentsByBox } from "@/server/repositories/agent_repository";
import { CreateFolderDialog } from "@/components/product/create_folder_dialog";
import { FileCreateDialog } from "@/components/product/file_create_dialog";
import { SkillCreateDialog } from "@/components/product/skill_create_dialog";
import { AgentCreateDialog } from "@/components/product/agent_create_dialog";
import { FolderWorkspaceActions } from "@/components/product/folder_workspace_actions";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folder_id: string }>;
}) {
  const { folder_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const folder = await getFolderById(supabase, folder_id);
  if (!folder) notFound();

  const box = await getBoxById(supabase, folder.box_id);
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const [folders, notes, files, skills, agents] = await Promise.all([
    listFoldersByBox(supabase, folder.box_id, { includeArchived: true }),
    listNotesByBox(supabase, folder.box_id, { includeArchived: true }),
    listFilesByBox(supabase, folder.box_id, { includeArchived: true }),
    listSkillsByBox(supabase, folder.box_id, { includeArchived: true }),
    listAgentsByBox(supabase, folder.box_id, { includeArchived: true }),
  ]);

  const childFolders = folders.filter((f) => f.parent_folder_id === folder.id);
  const childNotes = notes.filter((n) => n.folder_id === folder.id);
  const childFiles = files.filter((f) => f.folder_id === folder.id);
  const childSkills = skills.filter((s) => s.folder_id === folder.id);
  const childAgents = agents.filter((a) => a.folder_id === folder.id);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            <Link href={`/app/boxes/${box.id}`} className="hover:underline">{box.name}</Link>
            {" / "}
            <span>{folder.path_cache}</span>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold">
            <Folder className="h-5 w-5 text-muted-foreground" />
            {folder.name}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateFolderDialog boxId={box.id} parentFolderId={folder.id} />
          <FileCreateDialog boxId={box.id} folderId={folder.id} />
          <SkillCreateDialog boxId={box.id} folderId={folder.id} />
          <AgentCreateDialog boxId={box.id} folderId={folder.id} />
        </div>
      </div>

      <FolderWorkspaceActions folderId={folder.id} boxId={box.id} initialName={folder.name} />

      <section className="grid gap-4 md:grid-cols-2">
        <Panel title={`Folders (${childFolders.length})`} items={childFolders.map((f) => ({ id: f.id, label: f.name, href: `/app/folders/${f.id}` }))} />
        <Panel title={`Notes (${childNotes.length})`} items={childNotes.map((n) => ({ id: n.id, label: n.title, href: `/app/notes/${n.id}` }))} />
        <Panel title={`Files (${childFiles.length})`} items={childFiles.map((f) => ({ id: f.id, label: f.name, href: `/app/files/${f.id}` }))} />
        <Panel title={`Skills (${childSkills.length})`} items={childSkills.map((s) => ({ id: s.id, label: s.name, href: `/app/skills/${s.id}` }))} />
        <Panel title={`Agents (${childAgents.length})`} items={childAgents.map((a) => ({ id: a.id, label: a.name, href: `/app/agents/${a.id}` }))} />
      </section>
    </div>
  );
}

function Panel({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; label: string; href: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="mt-2 space-y-1">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">No items.</p>
        ) : (
          items.map((item) => (
            <Link key={item.id} href={item.href} className="block rounded px-2 py-1 text-sm hover:bg-accent/50">
              {item.label}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

