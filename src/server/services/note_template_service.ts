import { type SupabaseClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NoteTemplateRow {
  id: string;
  box_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  markdown_content: string;
  tags: string[];
  created_by: string | null;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  boxId: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  markdownContent?: string;
  tags?: string[];
  createdBy?: string | null;
}

export interface UpdateTemplatePatch {
  name?: string;
  description?: string | null;
  markdown_content?: string;
  tags?: string[];
  is_default?: boolean;
  sort_order?: number;
}

// ─── Built-in variable interpolation ──────────────────────────────────────────

/**
 * Replace `{{var}}` placeholders in template content with provided values.
 *
 * Built-in variables:
 *   - `{{date}}`     — today's ISO date (YYYY-MM-DD)
 *   - `{{user}}`     — current user display name / id
 *   - `{{box_name}}` — name of the target box
 *
 * Caller-supplied variables override built-ins if they share a key.
 * Unknown placeholders are left as-is so the user can fill them in.
 */
export function applyTemplate(
  templateContent: string,
  variables: Record<string, string> = {}
): string {
  const builtIns: Record<string, string> = {
    date: new Date().toISOString().slice(0, 10),
    user: variables.user ?? "",
    box_name: variables.box_name ?? "",
  };

  const merged = { ...builtIns, ...variables };

  return templateContent.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in merged ? merged[key] : match;
  });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Create a note template from scratch.
 */
export async function createTemplate(
  supabase: SupabaseClient,
  input: CreateTemplateInput
): Promise<NoteTemplateRow> {
  const { data, error } = await supabase
    .from("note_templates")
    .insert({
      box_id: input.boxId,
      workspace_id: input.workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      markdown_content: input.markdownContent ?? "",
      tags: input.tags ?? [],
      created_by: input.createdBy ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create template: ${error.message}`);
  return data as NoteTemplateRow;
}

/**
 * Create a template by copying a note's current content.
 *
 * The note's markdown_content, tags, and (optionally) title are carried
 * over. The caller can override name and description.
 */
export async function createTemplateFromNote(
  supabase: SupabaseClient,
  noteId: string,
  overrides: { name?: string; description?: string } = {}
): Promise<NoteTemplateRow> {
  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("title, box_id, workspace_id, tags, created_by, status")
    .eq("id", noteId)
    .neq("status", "trashed")
    .maybeSingle();

  if (noteError) throw new Error(noteError.message);
  if (!note) throw new Error("Note not found or is trashed");

  // Fetch the latest version's markdown content
  const { data: version, error: versionError } = await supabase
    .from("note_versions")
    .select("markdown_content")
    .eq("note_id", noteId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (versionError || !version) throw new Error("Note version not found");

  return createTemplate(supabase, {
    boxId: note.box_id,
    workspaceId: note.workspace_id,
    name: overrides.name?.trim() || `Template from ${note.title}`,
    description: overrides.description?.trim() ?? null,
    markdownContent: version.markdown_content ?? "",
    tags: note.tags ?? [],
    createdBy: note.created_by ?? null,
  });
}

/**
 * List templates for a box, ordered by sort_order.
 */
export async function listTemplates(
  supabase: SupabaseClient,
  boxId: string
): Promise<NoteTemplateRow[]> {
  const { data, error } = await supabase
    .from("note_templates")
    .select()
    .eq("box_id", boxId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list templates: ${error.message}`);
  return (data ?? []) as NoteTemplateRow[];
}

/**
 * List all templates across boxes in a workspace.
 */
export async function listWorkspaceTemplates(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<NoteTemplateRow[]> {
  const { data, error } = await supabase
    .from("note_templates")
    .select()
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list workspace templates: ${error.message}`);
  return (data ?? []) as NoteTemplateRow[];
}

/**
 * Get a single template by id.
 */
export async function getTemplate(
  supabase: SupabaseClient,
  templateId: string
): Promise<NoteTemplateRow | null> {
  const { data, error } = await supabase
    .from("note_templates")
    .select()
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get template: ${error.message}`);
  return data as NoteTemplateRow | null;
}

/**
 * Update a template with a partial patch.
 */
export async function updateTemplate(
  supabase: SupabaseClient,
  templateId: string,
  patch: UpdateTemplatePatch
): Promise<NoteTemplateRow> {
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.name !== undefined) updatePayload.name = patch.name.trim();
  if (patch.description !== undefined) updatePayload.description = patch.description;
  if (patch.markdown_content !== undefined) updatePayload.markdown_content = patch.markdown_content;
  if (patch.tags !== undefined) updatePayload.tags = patch.tags;
  if (patch.is_default !== undefined) updatePayload.is_default = patch.is_default;
  if (patch.sort_order !== undefined) updatePayload.sort_order = patch.sort_order;

  const { data, error } = await supabase
    .from("note_templates")
    .update(updatePayload)
    .eq("id", templateId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update template: ${error.message}`);
  return data as NoteTemplateRow;
}

/**
 * Delete a template permanently.
 */
export async function deleteTemplate(
  supabase: SupabaseClient,
  templateId: string
): Promise<void> {
  const { error } = await supabase
    .from("note_templates")
    .delete()
    .eq("id", templateId);

  if (error) throw new Error(`Failed to delete template: ${error.message}`);
}
