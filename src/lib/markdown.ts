import { marked } from "marked";

/**
 * Shared markdown rendering seam.
 *
 * All markdown rendering in the application goes through this module.
 * This ensures there is a single place to add sanitization, custom renderers,
 * or plugin configuration in the future.
 *
 * Security note (V1):
 *   renderMarkdown uses marked without HTML sanitization. This is acceptable
 *   in V1 because Context Store is a single-owner workspace — all note
 *   content is authored by the authenticated owner. When multi-user features
 *   are introduced, add sanitization here before the returned string reaches
 *   dangerouslySetInnerHTML. The function signature is intentionally narrow so
 *   that adding DOMPurify or a similar library requires changes only here.
 */

// Configure marked globally once. async: false ensures parse() returns string.
marked.setOptions({ async: false });

/**
 * Render a markdown string to an HTML string.
 * Returns a safe fallback on parse failure.
 *
 * @param content - Raw markdown text (may be empty string)
 * @returns HTML string suitable for dangerouslySetInnerHTML on owner-authored content
 */
export function renderMarkdown(content: string): string {
  if (!content) return "";
  try {
    return marked.parse(content) as string;
  } catch {
    return "<p><em>Preview unavailable</em></p>";
  }
}
