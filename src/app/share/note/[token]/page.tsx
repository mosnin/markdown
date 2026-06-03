import { type Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyNoteToken } from "@/lib/share_token";
import { getNoteById } from "@/server/repositories/note_repository";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const noteId = verifyNoteToken(token);
  if (!noteId) {
    return { title: "Shared note — Poggle" };
  }

  const supabase = createAdminClient();
  const note = await getNoteById(supabase, noteId);
  if (!note) {
    return { title: "Shared note — Poggle" };
  }

  const description =
    note.summary ?? "A note shared with you via Poggle.";

  return {
    title: `${note.title} — Poggle`,
    description,
    openGraph: {
      title: `${note.title} — Poggle`,
      description,
      type: "article",
    },
    twitter: {
      card: "summary",
      title: `${note.title} — Poggle`,
      description,
    },
  };
}

export default async function SharedNotePage({ params }: PageProps) {
  const { token } = await params;
  const noteId = verifyNoteToken(token);
  if (!noteId) notFound();

  const supabase = createAdminClient();
  const note = await getNoteById(supabase, noteId);
  if (!note) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Shared note</p>
        <h1 className="text-2xl font-semibold text-foreground">{note.title}</h1>
        {note.summary && (
          <p className="mt-2 text-sm text-muted-foreground">{note.summary}</p>
        )}
      </div>
      <article className="prose prose-neutral max-w-none dark:prose-invert">
        <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/90">
          {note.markdown_content}
        </pre>
      </article>
      <div className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">
        Shared via <Link href="/" className="underline hover:text-foreground">Poggle</Link>
      </div>
    </div>
  );
}
