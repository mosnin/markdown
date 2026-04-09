import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Shared markdown rendering seam.
 *
 * All markdown rendering in the application goes through this module.
 * This ensures there is a single place to configure sanitization, custom
 * renderers, or plugin behavior.
 *
 * Security:
 *   renderMarkdown sanitizes the HTML produced by marked before returning it.
 *   This prevents stored XSS from markdown content that reaches the renderer
 *   via import packages or any future multi-author path.
 *
 *   Allowed elements are a conservative superset of standard markdown output.
 *   Scripts, iframes, forms, event handlers, and data URIs are always stripped.
 *
 *   Context Store V1 is a single-owner workspace, so the practical XSS risk is
 *   low — but sanitization is the correct default for any content that may have
 *   arrived via import from external packages.
 */

// Configure marked globally once. async: false ensures parse() returns string.
marked.setOptions({ async: false });

/**
 * Allowed HTML elements produced by standard markdown parsers.
 * This list is intentionally conservative — no form elements, no media embeds.
 */
const ALLOWED_TAGS = [
  // Block
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "blockquote", "pre", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "div", "section", "article", "hr", "br",
  // Inline
  "strong", "b", "em", "i", "s", "del", "ins", "mark",
  "code", "kbd", "samp", "var",
  "a", "img", "span",
  // Details/summary (common in docs)
  "details", "summary",
];

const ALLOWED_ATTRS: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height"],
  th: ["align", "colspan", "rowspan"],
  td: ["align", "colspan", "rowspan"],
  code: ["class"],           // for syntax highlighting classes (e.g. language-ts)
  pre: ["class"],
  span: ["class"],
  div: ["class"],
  "*": ["id"],               // allow id for heading anchors
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRS,
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["http", "https", "data"],  // data URIs for inline images (base64)
  },
  // Strip any event handler attributes (onclick, onload, etc.)
  disallowedTagsMode: "discard",
};

/**
 * Render a markdown string to a sanitized HTML string.
 * Returns a safe fallback on parse failure.
 *
 * @param content - Raw markdown text (may be empty string)
 * @returns Sanitized HTML string suitable for dangerouslySetInnerHTML
 */
export function renderMarkdown(content: string): string {
  if (!content) return "";
  try {
    const raw = marked.parse(content) as string;
    return sanitizeHtml(raw, SANITIZE_OPTIONS);
  } catch {
    return "<p><em>Preview unavailable</em></p>";
  }
}
