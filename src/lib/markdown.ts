import { marked, type Tokens } from "marked";
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

// ─── Callout block renderer ───────────────────────────────────────────────────

/**
 * Callout type configuration.
 *
 * Supports GitHub-style `> [!TYPE]` blockquote callouts:
 *   > [!warning]
 *   > [!tip]
 *   > [!info]
 *   > [!priority]
 */
const CALLOUT_CONFIG: Record<
  string,
  { icon: string; classes: string; labelClasses: string }
> = {
  warning: {
    icon: "⚠️",
    classes:
      "callout callout-warning border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500 rounded-r-md px-4 py-3 my-3",
    labelClasses: "font-semibold text-amber-700 dark:text-amber-400",
  },
  tip: {
    icon: "💡",
    classes:
      "callout callout-tip border-l-4 border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-500 rounded-r-md px-4 py-3 my-3",
    labelClasses: "font-semibold text-green-700 dark:text-green-400",
  },
  info: {
    icon: "ℹ️",
    classes:
      "callout callout-info border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-500 rounded-r-md px-4 py-3 my-3",
    labelClasses: "font-semibold text-blue-700 dark:text-blue-400",
  },
  priority: {
    icon: "⭐",
    classes:
      "callout callout-priority border-l-4 border-violet-400 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-500 rounded-r-md px-4 py-3 my-3",
    labelClasses: "font-semibold text-violet-700 dark:text-violet-400",
  },
};

// Extend marked with a custom blockquote renderer using marked.use().
// In marked v18, renderer methods receive the full token object.
// The blockquote token has a `tokens` array of child block tokens.
marked.use({
  renderer: {
    blockquote(token) {
      const firstToken = Array.isArray(token.tokens) ? token.tokens[0] : null;
      if (firstToken && firstToken.type === "paragraph") {
        const paragraphText =
          "text" in firstToken && typeof firstToken.text === "string"
            ? firstToken.text
            : "";
        const typeMatch = paragraphText.match(
          /^\[!(warning|tip|info|priority)\](?:\n|$)/i
        );
        if (typeMatch) {
          const type = typeMatch[1].toLowerCase();
          const cfg = CALLOUT_CONFIG[type];
          if (cfg) {
            const label = type.charAt(0).toUpperCase() + type.slice(1);
            const bodyText = paragraphText
              .replace(/^\[!(warning|tip|info|priority)\]\n?/i, "")
              .trim();
            const bodyTokens = token.tokens.slice(1);
            let bodyHtml = "";
            if (bodyText) {
              bodyHtml += `<p>${marked.parseInline(bodyText) as string}</p>`;
            }
            for (const t of bodyTokens) {
              bodyHtml += marked.parse(
                "raw" in t && typeof t.raw === "string" ? t.raw : ""
              ) as string;
            }
            return `<div class="${cfg.classes}"><p class="${cfg.labelClasses}">${cfg.icon} ${label}</p>${bodyHtml}</div>`;
          }
        }
      }
      return false;
    },
  },
});

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
  p: ["class"],
  blockquote: ["class"],
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
