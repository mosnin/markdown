"use server";
// Ensures a "Today — YYYY-MM-DD" note exists in the user's Inbox box.
// Called fire-and-forget from the /app page via after().
// Idempotent: does nothing if the note already exists today.

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { listBoxesByWorkspace } from "@/server/repositories/box_repository";
import { listNotesByBox } from "@/server/repositories/note_repository";
import { createNote } from "@/server/services/note_service";

export async function ensureDailyNoteAction(): Promise<void> {
  const ctx = await requireAuthenticatedUser();
  const supabase = await createClient();

  const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
  const inbox = boxes.find((b) => /^inbox$/i.test(b.name));
  if (!inbox) return;

  const dateStr = new Date().toISOString().slice(0, 10);
  const title = `Today — ${dateStr}`;

  const notes = await listNotesByBox(supabase, inbox.id, {
    branchId: ctx.activeBranchId,
  });
  const alreadyExists = notes.some((n) => n.title === title);
  if (alreadyExists) return;

  const markdownContent = `# ${title}

<!-- Captures, thoughts, tasks for today. Ask Atlas AI to summarize at end of day. -->`;

  await createNote(supabase, ctx.user.id, ctx.workspace.id, {
    boxId: inbox.id,
    title,
    markdownContent,
    kind: "note",
  });
}
