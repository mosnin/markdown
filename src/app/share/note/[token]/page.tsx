import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyNoteToken } from "@/lib/share_token";
import { getNoteById } from "@/server/repositories/note_repository";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SharedNotePage({ params }: PageProps) {
  const { token } = await params;
  const noteId = verifyNoteToken(token);
  if (!noteId) notFound();

  const supabase = createAdminClient();
  const note = await getNoteById(supabase, noteId);
  if (!note) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Attribution / eyebrow */}
      <p className="text-overline text-muted-foreground">Shared note</p>

      <header className="mt-2 border-b border-border pb-6">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
          {note.title}
        </h1>
        {note.summary && (
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {note.summary}
          </p>
        )}
      </header>

      <article className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
        <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-foreground/90">
          {note.markdown_content}
        </pre>
      </article>

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
