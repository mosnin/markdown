import { type SupabaseClient } from "@supabase/supabase-js";
import { type Note } from "@/server/domain/types/note";
import { type NoteVersion } from "@/server/domain/types/note_version";
import { type ConnectionRequestContext } from "@/server/auth/get_connection_context";
import { PERMISSION_MODE } from "@/server/domain/constants/connection_constants";
import { getFolderById } from "@/server/repositories/folder_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { auditGeneratedNoteCreated } from "@/server/services/audit_service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateGeneratedNoteInput {
  /** Must belong to a box in the connection's scope. */
  folder_id: string;
  title?: string | null;
  markdown_content?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  /** Defaults to 'generated'. */
  read_hint?: string | null;
  retrieval_priority?: number;
}

export interface GeneratedNoteResult {
  note: Note;
  version: NoteVersion;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function notePathExists(
  adminClient: SupabaseClient,
  boxId: string,
  pathCache: string
): Promise<boolean> {
  const { data } = await adminClient
    .from("notes")
    .select("id")
    .eq("box_id", boxId)
    .eq("path_cache", pathCache)
    .neq("status", "trashed")
    .maybeSingle();
  return !!data;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
}

async function uniqueSlug(
  adminClient: SupabaseClient,
  boxId: string,
  folderPathCache: string,
  title: string
): Promise<{ slug: string; pathCache: string }> {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  let pathCache = `${folderPathCache}/${slug}`;

  while (await notePathExists(adminClient, boxId, pathCache)) {
    slug = `${base}-${suffix++}`;
    pathCache = `${folderPathCache}/${slug}`;
  }

  return { slug, pathCache };
}

/**
 * Default title for generated notes when caller does not supply one.
 * Format: <connection_name> YYYYMMDD_HHMMSS
 */
function defaultTitle(connectionName: string): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "_",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
  return `${connectionName} ${stamp}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a generated note directly in a folder.
 *
 * Authorization enforced here (not just in the route handler):
 * 1. connection.permission_mode must be generate_in_allowed_folders
 * 2. folder must exist and not be trashed
 * 3. folder.box_id must be in ctx.allowedBoxIds
 * 4. folder.accepts_generated_notes must be true
 *
 * Calls the atomic `create_generated_note_with_version` SQL function.
 */
export async function createGeneratedNote(
  adminClient: SupabaseClient,
  ctx: ConnectionRequestContext,
  input: CreateGeneratedNoteInput
): Promise<GeneratedNoteResult> {
  // Permission check
  if (ctx.connection.permission_mode !== PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS) {
    throw new Error(
      "Connection permission_mode must be generate_in_allowed_folders to create generated notes"
    );
  }

  // Folder validation
  const folder = await getFolderById(adminClient, input.folder_id);
  if (!folder || folder.status === "trashed") {
    throw new Error("Folder not found");
  }

  // Box scope check
  if (!ctx.allowedBoxIds.has(folder.box_id)) {
    throw new Error("Folder is not in an allowed box");
  }

  // Policy check
  if (!folder.accepts_generated_notes) {
    throw new Error(
      "Folder does not accept generated notes (accepts_generated_notes is false)"
    );
  }

  // Verify box ownership (defense in depth)
  const box = await getBoxById(adminClient, folder.box_id);
  if (!box || box.workspace_id !== ctx.connection.workspace_id || box.status === "trashed") {
    throw new Error("Box not found");
  }

  // Title resolution
  const title = input.title?.trim()
    ? input.title.trim()
    : defaultTitle(ctx.connection.name);

  // Unique slug / path_cache
  const { slug, pathCache } = await uniqueSlug(
    adminClient,
    folder.box_id,
    folder.path_cache,
    title
  );

  const markdown_content = input.markdown_content ?? "";
  const summary = input.summary ?? null;
  const tags = input.tags ?? [];
  const read_hint = input.read_hint ?? "generated";
  const retrieval_priority = input.retrieval_priority ?? 0;

  const { data, error } = await adminClient.rpc("create_generated_note_with_version", {
    p_box_id: folder.box_id,
    p_folder_id: folder.id,
    p_title: title,
    p_slug: slug,
    p_path_cache: pathCache,
    p_markdown_content: markdown_content,
    p_summary: summary,
    p_tags: tags,
    p_read_hint: read_hint,
    p_retrieval_priority: retrieval_priority,
    p_connection_id: ctx.connection.id,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create generated note");
  }

  const result = data as { note: Note; version: NoteVersion };

  // Fire-and-forget audit
  auditGeneratedNoteCreated(
    adminClient,
    ctx.connection.workspace_id,
    ctx.connection.id,
    result.note.id,
    {
      title: result.note.title,
      box_id: folder.box_id,
      folder_id: folder.id,
    }
  );

  return result;
}
