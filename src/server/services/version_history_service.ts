import { type SupabaseClient } from "@supabase/supabase-js";
import { type NoteVersion } from "@/server/domain/types/note_version";
import { type ObjectVersion } from "@/server/domain/types/object_version";
import { type Note } from "@/server/domain/types/note";
import { getNoteById } from "@/server/repositories/note_repository";
import {
  listVersionsByNote,
  getVersionByNoteAndId,
} from "@/server/repositories/note_version_repository";
import {
  listObjectVersions,
  getObjectVersionByObjectAndId,
} from "@/server/repositories/object_version_repository";
import { computeRollbackDiff } from "@/server/services/diff_utils";
import {
  auditNoteRollback,
  auditObjectRollback,
} from "@/server/services/audit_service";

/**
 * Version history service.
 *
 * Covers both note versions (note_versions table) and object versions
 * (object_versions table — used by files, skills, and agents).
 *
 * All public functions enforce ownership through the owning object's box
 * and workspace. The two-hop check (object → box → workspace_id) is the
 * canonical ownership pattern and must not be bypassed.
 *
 * Rollback creates a fresh new version from the selected historical snapshot.
 * Historical version rows are never mutated or deleted.
 *
 * Rollback is human-only — not exposed to external tools or connections.
 */

// ─── Note version types ───────────────────────────────────────────────────────

export interface VersionListItem extends NoteVersion {
  is_current: boolean;
}

export interface VersionHistoryResult {
  note_id: string;
  current_version_id: string | null;
  versions: VersionListItem[];
  total_fetched: number;
  limit: number;
  offset: number;
}

export interface VersionDetailResult {
  version: NoteVersion;
  is_current: boolean;
  note_id: string;
}

export interface RollbackResult {
  new_version_id: string;
  version_number: number;
  restored_from_version_id: string;
  note: Note;
}

// ─── Object version types ─────────────────────────────────────────────────────

export interface ObjectVersionListItem extends ObjectVersion {
  is_current: boolean;
}

export interface ObjectVersionHistoryResult {
  object_id: string;
  object_type: "file" | "skill" | "agent";
  current_version_id: string | null;
  versions: ObjectVersionListItem[];
  total_fetched: number;
  limit: number;
  offset: number;
}

export interface ObjectVersionDetailResult {
  version: ObjectVersion;
  is_current: boolean;
  object_id: string;
  object_type: "file" | "skill" | "agent";
}

export interface ObjectRollbackResult {
  new_version_id: string;
  version_number: number;
  restored_from_version_id: string;
  object_id: string;
  object_type: "file" | "skill" | "agent";
}

// ─── Note ownership check ─────────────────────────────────────────────────────

async function resolveNoteWithOwnership(
  supabase: SupabaseClient,
  noteId: string,
  workspaceId: string
): Promise<Note> {
  const note = await getNoteById(supabase, noteId);
  if (!note) throw new Error("Note not found");

  const { data: box } = await supabase
    .from("boxes")
    .select("workspace_id")
    .eq("id", note.box_id)
    .single();

  if (!box || box.workspace_id !== workspaceId) {
    throw new Error("Note not found");
  }

  return note;
}

// ─── Object ownership check ───────────────────────────────────────────────────

/**
 * Resolves a file/skill/agent and verifies workspace ownership.
 * Reusable objects (no box_id) are verified directly by workspace_id.
 * Box-local objects use the two-hop check (object → box → workspace_id).
 */
async function resolveObjectWithOwnership(
  supabase: SupabaseClient,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  workspaceId: string
): Promise<{
  id: string;
  name: string;
  source_content: string;
  current_version_id: string | null;
  box_id: string | null;
  is_reusable: boolean;
}> {
  const table = objectType === "file" ? "files" : objectType === "skill" ? "skills" : "agents";

  const { data, error } = await supabase
    .from(table)
    .select("id, name, source_content, current_version_id, box_id, is_reusable, workspace_id")
    .eq("id", objectId)
    .single();

  if (error || !data) throw new Error(`${objectType} not found`);

  const row = data as {
    id: string;
    name: string;
    source_content: string;
    current_version_id: string | null;
    box_id: string | null;
    is_reusable: boolean;
    workspace_id: string;
  };

  if (row.workspace_id !== workspaceId) throw new Error(`${objectType} not found`);

  // For box-local objects, verify via box ownership
  if (!row.is_reusable && row.box_id) {
    const { data: box } = await supabase
      .from("boxes")
      .select("workspace_id")
      .eq("id", row.box_id)
      .single();

    if (!box || box.workspace_id !== workspaceId) throw new Error(`${objectType} not found`);
  }

  return {
    id: row.id,
    name: row.name,
    source_content: row.source_content,
    current_version_id: row.current_version_id,
    box_id: row.box_id,
    is_reusable: row.is_reusable,
  };
}

// ─── Note version history ─────────────────────────────────────────────────────

/**
 * List versions for a note, newest first.
 * Enforces ownership: note must belong to the given workspace.
 */
export async function listVersionsForNote(
  supabase: SupabaseClient,
  workspaceId: string,
  noteId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<VersionHistoryResult> {
  const note = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  const versions = await listVersionsByNote(supabase, noteId, { limit, offset });

  return {
    note_id: noteId,
    current_version_id: note.current_version_id ?? null,
    versions: versions.map((v) => ({
      ...v,
      is_current: v.id === note.current_version_id,
    })),
    total_fetched: versions.length,
    limit,
    offset,
  };
}

/**
 * Fetch a single note version, verifying it belongs to the given note and workspace.
 */
export async function getVersionForNote(
  supabase: SupabaseClient,
  workspaceId: string,
  noteId: string,
  versionId: string
): Promise<VersionDetailResult> {
  const note = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  const version = await getVersionByNoteAndId(supabase, noteId, versionId);
  if (!version) throw new Error("Version not found");

  return {
    version,
    is_current: version.id === note.current_version_id,
    note_id: noteId,
  };
}

/**
 * Roll back a note to a prior version.
 *
 * Creates a new version whose content is a copy of the selected historical
 * snapshot, then advances the note's current_version_id.
 * The target historical version is never mutated.
 *
 * Rollback is human-only — not exposed to external tools.
 */
export async function rollbackNoteToVersion(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  noteId: string,
  targetVersionId: string
): Promise<RollbackResult> {
  const note = await resolveNoteWithOwnership(supabase, noteId, workspaceId);

  const targetVersion = await getVersionByNoteAndId(supabase, noteId, targetVersionId);
  if (!targetVersion) throw new Error("Version not found");

  const diffSummary = computeRollbackDiff(
    {
      title: note.title,
      markdown_content: note.markdown_content,
      content_bytes: note.content_bytes,
      summary: note.summary,
      tags: note.tags,
      status: note.status,
    },
    {
      title: targetVersion.title,
      markdown_content: targetVersion.markdown_content,
      content_bytes: targetVersion.content_bytes,
    }
  );

  const { data, error } = await supabase.rpc("rollback_note_to_version", {
    p_note_id: noteId,
    p_target_version_id: targetVersionId,
    p_actor_id: userId,
    p_diff_summary: diffSummary,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Rollback failed");
  }

  const rpcResult = data as { new_version_id: string; version_number: number };

  const updatedNote = await getNoteById(supabase, noteId);
  if (!updatedNote) throw new Error("Note not found after rollback");

  await auditNoteRollback(supabase, workspaceId, userId, noteId, {
    prior_version_id: note.current_version_id ?? null,
    restored_from_version_id: targetVersionId,
    new_version_id: rpcResult.new_version_id,
    box_id: note.box_id,
  });

  return {
    new_version_id: rpcResult.new_version_id,
    version_number: rpcResult.version_number,
    restored_from_version_id: targetVersionId,
    note: updatedNote,
  };
}

// ─── Object version history (file / skill / agent) ───────────────────────────

/**
 * List versions for a file, skill, or agent, newest first.
 * Enforces workspace ownership.
 */
export async function listVersionsForObject(
  supabase: SupabaseClient,
  workspaceId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<ObjectVersionHistoryResult> {
  const obj = await resolveObjectWithOwnership(supabase, objectType, objectId, workspaceId);

  const versions = await listObjectVersions(supabase, objectType, objectId, { limit, offset });

  return {
    object_id: objectId,
    object_type: objectType,
    current_version_id: obj.current_version_id,
    versions: versions.map((v) => ({
      ...v,
      is_current: v.id === obj.current_version_id,
    })),
    total_fetched: versions.length,
    limit,
    offset,
  };
}

/**
 * Fetch a single object version, verifying it belongs to the given object and workspace.
 */
export async function getVersionForObject(
  supabase: SupabaseClient,
  workspaceId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  versionId: string
): Promise<ObjectVersionDetailResult> {
  const obj = await resolveObjectWithOwnership(supabase, objectType, objectId, workspaceId);

  const version = await getObjectVersionByObjectAndId(supabase, objectType, objectId, versionId);
  if (!version) throw new Error("Version not found");

  return {
    version,
    is_current: version.id === obj.current_version_id,
    object_id: objectId,
    object_type: objectType,
  };
}

/**
 * Roll back a file, skill, or agent to a prior version.
 *
 * Creates a new version whose source_content is a copy of the selected
 * historical snapshot, then advances current_version_id on the owning table.
 * The target historical version is never mutated.
 *
 * Rollback is human-only — not exposed to external tools.
 */
export async function rollbackObjectToVersion(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  objectType: "file" | "skill" | "agent",
  objectId: string,
  targetVersionId: string
): Promise<ObjectRollbackResult> {
  const obj = await resolveObjectWithOwnership(supabase, objectType, objectId, workspaceId);

  // Verify target version belongs to this object
  const targetVersion = await getObjectVersionByObjectAndId(
    supabase, objectType, objectId, targetVersionId
  );
  if (!targetVersion) throw new Error("Version not found");

  // Build diff_summary: current → target
  const diffSummary = {
    bytes_before: obj.source_content ? Buffer.from(obj.source_content, "utf-8").length : 0,
    bytes_after: targetVersion.content_bytes,
    restored_from_version_number: targetVersion.version_number,
  };

  const { data, error } = await supabase.rpc("rollback_object_to_version", {
    p_object_type: objectType,
    p_object_id: objectId,
    p_target_version_id: targetVersionId,
    p_actor_id: userId,
    p_diff_summary: diffSummary,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Rollback failed");
  }

  const rpcResult = data as { new_version_id: string; version_number: number };

  await auditObjectRollback(supabase, workspaceId, userId, objectType, objectId, {
    prior_version_id: obj.current_version_id ?? null,
    restored_from_version_id: targetVersionId,
    new_version_id: rpcResult.new_version_id,
    name: obj.name,
    is_reusable: obj.is_reusable,
  });

  return {
    new_version_id: rpcResult.new_version_id,
    version_number: rpcResult.version_number,
    restored_from_version_id: targetVersionId,
    object_id: objectId,
    object_type: objectType,
  };
}
