import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyBoxToken } from "@/lib/share_token";
import { getBoxById } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import Link from "next/link";
import { FileText } from "lucide-react";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SharedBoxPage({ params }: PageProps) {
  const { token } = await params;
  const boxId = verifyBoxToken(token);
  if (!boxId) notFound();

  const supabase = createAdminClient();
  const box = await getBoxById(supabase, boxId);
  if (!box) notFound();

  const notes = await listNotesByBox(supabase, boxId, { limit: 100, branchId: null });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Attribution / eyebrow */}
      <p className="text-overline text-muted-foreground">Shared box</p>

      <header className="mt-2 border-b border-border pb-6">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
          {box.name}
        </h1>
        {box.description && (
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {box.description}
          </p>
        )}
      </header>

      <section className="mt-8">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes in this box.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {notes.map((note) => (
              <li
                key={note.id}
                className="flex items-center gap-2.5 px-4 py-3"
              >
                <FileText
                  className="h-4 w-4 shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                />
                <span className="truncate text-sm text-foreground">
                  {note.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-16 border-t border-border pt-4 text-xs text-muted-foreground">
        Shared via{" "}
        <Link
          href="/"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          Poggle
        </Link>
      </footer>
    </div>
  );
}
