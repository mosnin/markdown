import { type SupabaseClient } from "@supabase/supabase-js";
import { getBoxTemplate, type BoxTemplate } from "@/lib/templates";
import { createFolder } from "@/server/services/folder_service";
import { createNote } from "@/server/services/note_service";
import { assignGuideNote } from "@/server/services/guide_service";
import { auditBoxTemplateApplied } from "@/server/services/audit_service";

export interface ApplyBoxTemplateResult {
  guideNoteId: string | null;
  folderCount: number;
  noteCount: number;
}

/**
 * Apply a box template: create folders and notes with canonical metadata
 * defaults, optionally assign the guide note, and fire a single audit event.
 *
 * All underlying calls go through normal service functions — no versioning,
 * audit, or ownership checks are bypassed.
 */
export async function applyBoxTemplate(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  boxId: string,
  templateId: string
): Promise<ApplyBoxTemplateResult> {
  const template: BoxTemplate | undefined = getBoxTemplate(templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  // Create folders first, tracking key → id for note placement.
  const folderIdMap = new Map<string, string>();
  for (const folderDef of template.folders) {
    const folder = await createFolder(supabase, userId, workspaceId, {
      boxId,
      name: folderDef.name,
      parentFolderId: null,
    });
    folderIdMap.set(folderDef.key, folder.id);
  }

  // Create notes with template-defined metadata defaults.
  let guideNoteId: string | null = null;
  for (const noteDef of template.notes) {
    const folderId = noteDef.folderKey ? (folderIdMap.get(noteDef.folderKey) ?? null) : null;
    const note = await createNote(supabase, userId, workspaceId, {
      boxId,
      folderId,
      title: noteDef.title,
      kind: noteDef.kind,
      markdownContent: noteDef.markdownContent,
      readHint: noteDef.readHint ?? null,
    });
    if (noteDef.isGuide) {
      guideNoteId = note.id;
    }
  }

  // Assign guide note if one was designated in the template.
  if (guideNoteId) {
    await assignGuideNote(supabase, userId, workspaceId, boxId, guideNoteId);
  }

  // Fire template audit event (fire-and-forget — errors do not abort the operation).
  auditBoxTemplateApplied(supabase, workspaceId, userId, boxId, {
    template_id: templateId,
    folder_count: template.folders.length,
    note_count: template.notes.length,
  });

  return {
    guideNoteId,
    folderCount: template.folders.length,
    noteCount: template.notes.length,
  };
}
