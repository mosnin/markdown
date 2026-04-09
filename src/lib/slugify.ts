/**
 * Convert an arbitrary display name to a URL-safe slug.
 *
 * Output always satisfies: /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
 * Falls back to "item" if the title produces no valid characters.
 */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .replace(/[^a-z0-9\s-]/g, "")   // keep alphanum, spaces, hyphens
      .trim()
      .replace(/[\s-]+/g, "-")         // collapse spaces / multiple hyphens
      .replace(/^-+|-+$/g, "")         // strip leading/trailing hyphens
      .slice(0, 60) || "item"
  );
}
