"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import {
  listBoxesByWorkspace,
  createBox,
} from "@/server/repositories/box_repository";
import { createNote } from "@/server/services/note_service";
import { inngest } from "@/lib/inngest/client";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface QuickCaptureInput {
  title: string;
  markdown: string;
  /** When null, auto-pick or auto-create an "Inbox" box. */
  boxId: string | null;
}

export interface QuickCaptureOutput {
  noteId: string;
  boxId: string;
  boxName: string;
}

export async function quickCaptureAction(
  input: QuickCaptureInput
): Promise<ActionResult<QuickCaptureOutput>> {
  let ctx;
  try {
    ctx = await requireAuthenticatedUser();
  } catch {
    return { ok: false, error: "Sign in required to capture." };
  }

  const title = input.title?.trim();
  const markdown = (input.markdown ?? "").trim();
  if (!title && !markdown) {
    return { ok: false, error: "Add a title or some text first." };
  }
  if (title && title.length > 200) {
    return { ok: false, error: "Title too long (max 200 chars)." };
  }
  if (markdown.length > 50000) {
    return { ok: false, error: "Note too long (max 50k chars)." };
  }

  const supabase = await createClient();

  let resolvedBoxId = input.boxId;
  let resolvedBoxName = "";

  if (!resolvedBoxId) {
    // Look for an existing "Inbox" box, else auto-create one
    const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
    const inbox = boxes.find((b) => /^inbox$/i.test(b.name));
    if (inbox) {
      resolvedBoxId = inbox.id;
      resolvedBoxName = inbox.name;
    } else {
      // Pick a slug that doesn't collide with existing
      const usedSlugs = new Set(boxes.map((b) => b.slug));
      let slug = "inbox";
      let n = 2;
      while (usedSlugs.has(slug)) {
        slug = `inbox-${n}`;
        n++;
      }
      try {
        const created = await createBox(supabase, {
          workspace_id: ctx.workspace.id,
          name: "Inbox",
          slug,
          description: "Quick captures from the mobile composer.",
        });
        resolvedBoxId = created.id;
        resolvedBoxName = created.name;

        // Seed the new Inbox with a guide note so new users understand
        // how to use it.
        const INBOX_GUIDE_CONTENT = `# Your Inbox — how it works

This is your capture zone. Anything you save quickly — from your phone, browser, or voice — lands here first.

**How to use it:**
- Drop raw thoughts here, then move them to the right box later
- Use the "Ask AI" conversation to triage: "Organize my inbox notes into the right collections"
- Notes here show up in workspace-wide searches immediately

**Tip:** Keep this collection for unprocessed captures. When it grows past ~20 notes, ask Pog to help you sort them.`;
        try {
          await createNote(supabase, ctx.user.id, ctx.workspace.id, {
            boxId: created.id,
            title: "How your Inbox works",
            markdownContent: INBOX_GUIDE_CONTENT,
            kind: "guide",
          });
        } catch (guideErr) {
          // Non-fatal: the box was created successfully; log and continue.
          console.error("[quickCapture] Failed to seed Inbox guide note", guideErr);
        }
      } catch (err) {
        return {
          ok: false,
          error: `Could not create Inbox box: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    }
  } else {
    // Use the provided boxId; look up its name for the toast
    const boxes = await listBoxesByWorkspace(supabase, ctx.workspace.id);
    const box = boxes.find((b) => b.id === resolvedBoxId);
    if (!box) {
      return {
        ok: false,
        error: "Selected box was not found in this workspace.",
      };
    }
    resolvedBoxName = box.name;
  }

  try {
    const note = await createNote(supabase, ctx.user.id, ctx.workspace.id, {
      boxId: resolvedBoxId!,
      title: title || markdown.split("\n")[0].slice(0, 80) || "Untitled capture",
      markdownContent: markdown,
    });

    // Emit note.created so Inngest can fan out to any note_created triggers.
    // Publish latency / transient Inngest failures must not block the capture
    // response, so we swallow errors here.
    try {
      await inngest.send({
        name: "note.created",
        data: {
          workspaceId: ctx.workspace.id,
          noteId: note.id,
          boxId: resolvedBoxId!,
          userId: ctx.user.id,
        },
      });
    } catch (err) {
      console.error("[quickCaptureAction] inngest emit failed:", err);
    }

    return {
      ok: true,
      data: {
        noteId: note.id,
        boxId: resolvedBoxId!,
        boxName: resolvedBoxName,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Could not save note: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
