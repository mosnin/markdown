/**
 * link_frontmatter.ts
 *
 * Utility for generating and stripping YAML frontmatter that lists a note's
 * outgoing links. The frontmatter is prepended to the stored markdown_content
 * so that external tools (export, AI context) can parse link topology without
 * a database query.
 *
 * Format:
 *
 *   ---
 *   links:
 *     - target: "Note Title B"
 *       type: "depends_on"
 *     - target: "Note Title C"
 *       type: "reference_for"
 *       note: "See section 3"
 *   ---
 *
 * The block is always the first thing in the stored content and is bounded by
 * `---` fences. It is stripped before display in the editor via
 * `stripLinkFrontmatter` so users never see it while editing.
 */

import { type NoteLink } from "@/server/domain/types/note_link";
import { type Note } from "@/server/domain/types/note";

export interface FrontmatterLinkEntry {
  target: string;
  type: string;
  note?: string;
}

const FRONTMATTER_FENCE = "---";
// Matches a leading YAML block that starts with `links:` — our generated block.
const LINK_FRONTMATTER_RE = /^---\nlinks:[\s\S]*?\n---\n/;

/**
 * Build the YAML frontmatter string for a set of outgoing links.
 *
 * Returns an empty string when there are no outgoing links so callers can
 * simply prepend it without a guard.
 */
export function generateLinkFrontmatter(
  outgoingLinks: NoteLink[],
  noteMap: Map<string, Note>
): string {
  if (outgoingLinks.length === 0) return "";

  const entries: FrontmatterLinkEntry[] = outgoingLinks.map((link) => {
    const target = noteMap.get(link.target_note_id);
    const entry: FrontmatterLinkEntry = {
      target: target?.title ?? link.target_note_id,
      type: link.relationship_type,
    };
    if (link.relationship_note) {
      entry.note = link.relationship_note;
    }
    return entry;
  });

  const lines: string[] = [FRONTMATTER_FENCE, "links:"];
  for (const e of entries) {
    // Escape double-quotes inside the title
    const safeTarget = e.target.replace(/"/g, '\\"');
    lines.push(`  - target: "${safeTarget}"`);
    lines.push(`    type: "${e.type}"`);
    if (e.note) {
      const safeNote = e.note.replace(/"/g, '\\"');
      lines.push(`    note: "${safeNote}"`);
    }
  }
  lines.push(FRONTMATTER_FENCE);
  // Trailing newline so the user's content starts cleanly on the next line
  lines.push("");

  return lines.join("\n");
}

/**
 * Prepend the generated frontmatter to the raw markdown content, replacing
 * any existing link frontmatter block. Idempotent — calling twice produces the
 * same result.
 */
export function applyLinkFrontmatter(
  outgoingLinks: NoteLink[],
  noteMap: Map<string, Note>,
  rawContent: string
): string {
  // Strip any existing link frontmatter block first
  const stripped = stripLinkFrontmatter(rawContent);
  const fm = generateLinkFrontmatter(outgoingLinks, noteMap);
  return fm + stripped;
}

/**
 * Remove the auto-generated link frontmatter block from stored content before
 * displaying it in the editor. Non-destructive: if there is no such block the
 * content is returned unchanged.
 */
export function stripLinkFrontmatter(content: string): string {
  return content.replace(LINK_FRONTMATTER_RE, "");
}

/**
 * Render the frontmatter as a human-readable string suitable for a
 * "Copy frontmatter" button. Returns null when there are no outgoing links.
 */
export function formatFrontmatterForCopy(
  outgoingLinks: NoteLink[],
  noteMap: Map<string, Note>
): string | null {
  const fm = generateLinkFrontmatter(outgoingLinks, noteMap);
  return fm || null;
}
