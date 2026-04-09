import { notFound } from "next/navigation";
import { ChevronRight, Clock, GitBranch } from "lucide-react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { getFolderById } from "@/server/repositories/folder_repository";
import { NoteEditor } from "@/components/product/note_editor";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(dateStr);
}

// ─── Right panel ──────────────────────────────────────────────────────────────

function NoteMetaPanel({
  note,
  boxName,
  folderName,
  workspaceName,
}: {
  note: NonNullable<Awaited<ReturnType<typeof getNoteById>>>;
  boxName: string;
  folderName: string | null;
  workspaceName: string;
}) {
  const kindLabel: Record<string, string> = {
    note: "Note",
    guide: "Guide",
    bundle: "Bundle",
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Note details
        </p>
      </div>
      <ScrollArea className="flex-1">
        {/* Identity */}
        <div className="border-b border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {kindLabel[note.kind] ?? note.kind}
          </p>
          <p className="mt-0.5 line-clamp-3 text-sm font-medium text-foreground">
            {note.title}
          </p>
        </div>

        {/* Tags */}
        {note.tags.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Tags
            </p>
            <div className="flex flex-wrap gap-1">
              {note.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Location */}
        <div className="border-b border-border px-4 py-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Location
          </p>
          <div className="flex flex-col gap-1 text-xs">
            <MetaRow label="Workspace" value={workspaceName} />
            <MetaRow
              label="Box"
              value={boxName}
              href={`/app/boxes/${note.box_id}`}
            />
            {folderName && <MetaRow label="Folder" value={folderName} />}
          </div>
        </div>

        {/* Version info */}
        <div className="border-b border-border px-4 py-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Version
          </p>
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-start gap-2 py-0.5">
              <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Current version
                </p>
                <p className="font-mono text-[11px] text-foreground/80">
                  {note.current_version_id
                    ? note.current_version_id.slice(0, 8) + "…"
                    : "—"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 py-0.5">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Last updated
                </p>
                <p className="text-foreground/80">
                  {formatRelativeDate(note.updated_at)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        {note.summary && (
          <div className="px-4 py-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Summary
            </p>
            <p className="text-xs text-foreground/80 leading-relaxed">
              {note.summary}
            </p>
          </div>
        )}

        {/* Read hint */}
        {note.read_hint && (
          <div className="px-4 py-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Read hint
            </p>
            <p className="text-xs text-muted-foreground italic leading-relaxed">
              {note.read_hint}
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function MetaRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
        {href ? (
          <Link
            href={href}
            className="text-foreground/80 hover:text-foreground hover:underline underline-offset-2"
          >
            {value}
          </Link>
        ) : (
          <p className="text-foreground/80">{value}</p>
        )}
      </div>
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  workspaceName,
  boxId,
  boxName,
  folderName,
}: {
  workspaceName: string;
  boxId: string;
  boxName: string;
  folderName: string | null;
}) {
  const parts = [
    { label: workspaceName, href: "/app/workspaces" },
    { label: boxName, href: `/app/boxes/${boxId}` },
    ...(folderName ? [{ label: folderName, href: null }] : []),
  ];

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      {parts.map((part, i) => (
        <span key={part.label} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3" />}
          {part.href ? (
            <Link
              href={part.href}
              className="hover:text-foreground hover:underline underline-offset-2"
            >
              {part.label}
            </Link>
          ) : (
            <span>{part.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NotePage({
  params,
}: {
  params: Promise<{ note_id: string }>;
}) {
  const { note_id } = await params;
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  // Load note and verify ownership via its box
  const note = await getNoteById(supabase, note_id);
  if (!note) notFound();

  const box = await getBoxById(supabase, note.box_id);
  if (!box || box.workspace_id !== ctx.workspace.id) notFound();

  const folder = note.folder_id
    ? await getFolderById(supabase, note.folder_id)
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main editing area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Breadcrumb header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <Breadcrumb
            workspaceName={ctx.workspace.name}
            boxId={box.id}
            boxName={box.name}
            folderName={folder?.name ?? null}
          />
        </div>

        {/* Editor fills the remaining space */}
        <NoteEditor note={note} />
      </div>

      {/* Right metadata panel */}
      <aside className="hidden lg:flex lg:h-full lg:w-72 lg:shrink-0 lg:flex-col lg:border-l lg:border-border lg:bg-background">
        <NoteMetaPanel
          note={note}
          boxName={box.name}
          folderName={folder?.name ?? null}
          workspaceName={ctx.workspace.name}
        />
      </aside>
    </div>
  );
}
