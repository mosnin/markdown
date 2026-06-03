import { type Metadata } from "next";
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const boxId = verifyBoxToken(token);
  if (!boxId) {
    return { title: "Shared box — Poggle" };
  }

  const supabase = createAdminClient();
  const box = await getBoxById(supabase, boxId);
  if (!box) {
    return { title: "Shared box — Poggle" };
  }

  const description =
    box.description ?? "A knowledge box shared with you via Poggle.";

  return {
    title: `${box.name} — Poggle`,
    description,
    openGraph: {
      title: `${box.name} — Poggle`,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${box.name} — Poggle`,
      description,
    },
  };
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
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Shared box</p>
        <h1 className="text-2xl font-semibold text-foreground">{box.name}</h1>
        {box.description && (
          <p className="mt-2 text-sm text-muted-foreground">{box.description}</p>
        )}
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes in this box.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span className="text-sm text-foreground">{note.title}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">
        Shared via <Link href="/" className="underline hover:text-foreground">Poggle</Link>
      </div>
    </div>
  );
}
