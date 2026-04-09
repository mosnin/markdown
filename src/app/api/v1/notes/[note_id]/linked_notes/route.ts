import { type NextRequest } from "next/server";
import { getConnectionContext } from "@/server/auth/get_connection_context";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNoteById, getNotesByIds } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import {
  listLinksFromNote,
  listLinksToNote,
} from "@/server/repositories/note_link_repository";
import { apiOk, E_UNAUTHORIZED, E_FORBIDDEN, E_NOT_FOUND } from "@/lib/api/response";

/**
 * GET /api/v1/notes/[note_id]/linked_notes
 *
 * Returns all notes explicitly linked to or from the given note.
 *
 * Authorization:
 *   - The note's box must be in the connection's allowed box scopes.
 *   - Only linked notes in the same box (and allowed scope) are returned.
 *   - Trashed linked notes are excluded.
 *
 * Response shape:
 *   data: {
 *     note_id: string,
 *     links: Array<{
 *       id, source_note_id, target_note_id, relationship_type,
 *       direction: "outgoing" | "incoming"
 *     }>,
 *     notes: Array<{ id, title, slug, path_cache, summary, tags, read_hint, kind, status, updated_at }>
 *   }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ note_id: string }> }
) {
  const ctx = await getConnectionContext(request);
  if (!ctx) return E_UNAUTHORIZED();

  const { note_id } = await params;
  const adminClient = createAdminClient();

  const note = await getNoteById(adminClient, note_id);
  if (!note || note.status === "trashed") return E_NOT_FOUND("Note not found");

  if (!ctx.allowedBoxIds.has(note.box_id)) return E_FORBIDDEN();

  const box = await getBoxById(adminClient, note.box_id);
  if (!box || box.workspace_id !== ctx.workspaceId) return E_FORBIDDEN();

  const [outgoing, incoming] = await Promise.all([
    listLinksFromNote(adminClient, note_id),
    listLinksToNote(adminClient, note_id),
  ]);

  // Resolve linked note IDs, deduplicating
  const linkedNoteIds = new Set<string>();
  outgoing.forEach((l) => linkedNoteIds.add(l.target_note_id));
  incoming.forEach((l) => linkedNoteIds.add(l.source_note_id));

  const linkedNotes =
    linkedNoteIds.size > 0
      ? await getNotesByIds(adminClient, Array.from(linkedNoteIds))
      : [];

  // Only include notes from the same allowed box
  const visibleNoteIds = new Set(
    linkedNotes
      .filter(
        (n) =>
          n.status !== "trashed" && ctx.allowedBoxIds.has(n.box_id)
      )
      .map((n) => n.id)
  );

  const links = [
    ...outgoing
      .filter((l) => visibleNoteIds.has(l.target_note_id))
      .map((l) => ({
        id: l.id,
        source_note_id: l.source_note_id,
        target_note_id: l.target_note_id,
        relationship_type: l.relationship_type,
        relationship_note: l.relationship_note,
        created_at: l.created_at,
        direction: "outgoing" as const,
      })),
    ...incoming
      .filter((l) => visibleNoteIds.has(l.source_note_id))
      .map((l) => ({
        id: l.id,
        source_note_id: l.source_note_id,
        target_note_id: l.target_note_id,
        relationship_type: l.relationship_type,
        relationship_note: l.relationship_note,
        created_at: l.created_at,
        direction: "incoming" as const,
      })),
  ];

  const notes = linkedNotes
    .filter((n) => visibleNoteIds.has(n.id))
    .map((n) => ({
      id: n.id,
      box_id: n.box_id,
      folder_id: n.folder_id,
      title: n.title,
      slug: n.slug,
      path_cache: n.path_cache,
      summary: n.summary,
      tags: n.tags,
      read_hint: n.read_hint,
      kind: n.kind,
      status: n.status,
      updated_at: n.updated_at,
    }));

  return apiOk({ note_id, links, notes });
}
