import { type SupabaseClient } from "@supabase/supabase-js";
import { type ContextBundle } from "@/server/domain/types/context_bundle";
import { getNotesByIds } from "@/server/repositories/note_repository";

/**
 * Bundle → Markdown renderer.
 *
 * Used by the `/p/n/[token]` pull-token route when the agent prefers
 * `text/markdown` (or asks for `<token>.md`). The shape is intentionally
 * close to the markdown produced by the welcome step-3 setup wizard so
 * an AI seeing one will recognize the other.
 *
 * Output layout:
 *   ---
 *   <YAML frontmatter>
 *   ---
 *   # Context Bundle: <title>
 *   ## [PRIMARY] <title>
 *   ## [GUIDE] ...
 *   ## [ANCESTOR SUMMARY] ...
 *   ## [LINKED] ...
 *
 * Bounds:
 *   - Each note body is truncated to 8 000 chars.
 *   - The whole document is truncated to 50 000 chars (a `… [truncated]`
 *     marker is appended when the limit kicks in).
 */

// ─── Limits ───────────────────────────────────────────────────────────────────

const PER_NOTE_BODY_MAX = 8_000;
const TOTAL_DOCUMENT_MAX = 50_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeYamlString(value: string): string {
  // Quote and escape minimally so the frontmatter stays valid for the most
  // permissive YAML parsers. We only need single-quote escaping (double the
  // quote) per YAML 1.2 single-quoted style.
  return `'${value.replace(/'/g, "''")}'`;
}

function truncateBody(body: string | null): string {
  if (!body) return "";
  if (body.length <= PER_NOTE_BODY_MAX) return body;
  return `${body.slice(0, PER_NOTE_BODY_MAX)}\n\n…[note body truncated at ${PER_NOTE_BODY_MAX} chars]`;
}

// ─── Public input ─────────────────────────────────────────────────────────────

export interface RenderBundleMarkdownInput {
  bundle: ContextBundle;
  /** Workspace name for the YAML frontmatter — surfaced for AI context. */
  workspaceName: string;
  /** ISO 8601 expiry to embed in the frontmatter. */
  expiresAt: string;
  /**
   * Map of note id → markdown body. The route handler hydrates this for
   * every note id in the bundle (target + guide + linked + ancestor) so
   * the helper can render bodies without re-running queries.
   */
  bodiesById: Map<string, string | null>;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export function renderBundleMarkdown({
  bundle,
  workspaceName,
  expiresAt,
  bodiesById,
}: RenderBundleMarkdownInput): string {
  const lines: string[] = [];

  // ── YAML frontmatter ────────────────────────────────────────────────────────
  lines.push("---");
  lines.push(`title: ${escapeYamlString(bundle.target_note.title)}`);
  lines.push(`object_id: ${escapeYamlString(bundle.target_note.id)}`);
  lines.push(`workspace_name: ${escapeYamlString(workspaceName)}`);
  lines.push(`expires_at: ${escapeYamlString(expiresAt)}`);
  lines.push(`box: ${escapeYamlString(bundle.box.name)}`);
  if (bundle.target_note.path_cache) {
    lines.push(`path: ${escapeYamlString(bundle.target_note.path_cache)}`);
  }
  lines.push(`linked_notes: ${bundle.linked_notes.length}`);
  if (bundle.truncated) {
    lines.push(
      `truncation_reasons: ${escapeYamlString(bundle.truncation_reasons.join(","))}`
    );
  }
  lines.push("---");
  lines.push("");

  // ── Heading + warnings ──────────────────────────────────────────────────────
  lines.push(`# Context Bundle: ${bundle.target_note.title}`);
  lines.push(`Assembled: ${bundle.assembly_metadata.assembled_at}`);
  if (bundle.truncated) {
    lines.push("(Bundle was truncated due to size limits)");
  }
  lines.push("");

  // ── Primary ─────────────────────────────────────────────────────────────────
  lines.push("---");
  lines.push(`## [PRIMARY] ${bundle.target_note.title}`);
  lines.push(`Path: ${bundle.target_note.path_cache}`);
  if (bundle.target_note.tags.length > 0) {
    lines.push(`Tags: ${bundle.target_note.tags.join(", ")}`);
  }
  lines.push("");
  if (bundle.target_note.summary) {
    lines.push(`> ${bundle.target_note.summary}`);
    lines.push("");
  }
  const primaryBody = truncateBody(bodiesById.get(bundle.target_note.id) ?? null);
  if (primaryBody) {
    lines.push(primaryBody);
    lines.push("");
  }

  // ── Guide ──────────────────────────────────────────────────────────────────
  if (bundle.guide_note) {
    lines.push("---");
    lines.push(`## [GUIDE] ${bundle.guide_note.title}`);
    if (bundle.guide_note.path_cache) {
      lines.push(`Path: ${bundle.guide_note.path_cache}`);
    }
    lines.push("");
    if (bundle.guide_note.summary) {
      lines.push(`> ${bundle.guide_note.summary}`);
      lines.push("");
    }
    const body = truncateBody(bodiesById.get(bundle.guide_note.id) ?? null);
    if (body) {
      lines.push(body);
      lines.push("");
    }
  }

  // ── Ancestor summary ───────────────────────────────────────────────────────
  if (bundle.ancestor_summary_note) {
    lines.push("---");
    lines.push(`## [ANCESTOR SUMMARY] ${bundle.ancestor_summary_note.title}`);
    if (bundle.ancestor_summary_note.path_cache) {
      lines.push(`Path: ${bundle.ancestor_summary_note.path_cache}`);
    }
    lines.push("");
    if (bundle.ancestor_summary_note.summary) {
      lines.push(`> ${bundle.ancestor_summary_note.summary}`);
      lines.push("");
    }
    const body = truncateBody(
      bodiesById.get(bundle.ancestor_summary_note.id) ?? null
    );
    if (body) {
      lines.push(body);
      lines.push("");
    }
  }

  // ── Linked ─────────────────────────────────────────────────────────────────
  for (const linked of bundle.linked_notes) {
    lines.push("---");
    lines.push(`## [LINKED] ${linked.title} (${linked.relationship_type})`);
    if (linked.path_cache) {
      lines.push(`Path: ${linked.path_cache}`);
    }
    if (linked.relationship_note) {
      lines.push(`Note on relationship: ${linked.relationship_note}`);
    }
    lines.push("");
    if (linked.summary) {
      lines.push(`> ${linked.summary}`);
      lines.push("");
    }
    const body = truncateBody(bodiesById.get(linked.id) ?? null);
    if (body) {
      lines.push(body);
      lines.push("");
    }
  }

  // ── Final document-level cap ───────────────────────────────────────────────
  const text = lines.join("\n");
  if (text.length <= TOTAL_DOCUMENT_MAX) return text;
  return `${text.slice(0, TOTAL_DOCUMENT_MAX)}\n\n…[bundle markdown truncated at ${TOTAL_DOCUMENT_MAX} chars]`;
}

// ─── Body hydration helper ────────────────────────────────────────────────────

/**
 * Fetch markdown bodies for every note id referenced in the bundle so
 * `renderBundleMarkdown` can include them without firing additional
 * queries from inside the renderer.
 */
export async function hydrateBundleBodies(
  client: SupabaseClient,
  bundle: ContextBundle
): Promise<Map<string, string | null>> {
  const ids = new Set<string>();
  ids.add(bundle.target_note.id);
  if (bundle.guide_note) ids.add(bundle.guide_note.id);
  if (bundle.ancestor_summary_note) ids.add(bundle.ancestor_summary_note.id);
  for (const linked of bundle.linked_notes) ids.add(linked.id);

  const notes = await getNotesByIds(client, [...ids]);
  const out = new Map<string, string | null>();
  for (const note of notes) {
    const body =
      typeof (note as { markdown_content?: unknown }).markdown_content === "string"
        ? ((note as { markdown_content: string }).markdown_content)
        : null;
    out.set(note.id, body);
  }
  return out;
}
