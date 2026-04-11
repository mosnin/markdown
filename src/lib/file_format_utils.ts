/**
 * File format utilities.
 *
 * Maps between SOURCE_FORMAT enum values and human-readable display info,
 * file extensions, MIME types, and language identifiers.
 *
 * Notes are NEVER in this map — notes are always markdown and handled separately.
 * This utility is exclusively for the Files object type.
 */
import { SOURCE_FORMAT, type SourceFormat } from "@/server/domain/constants/object_constants";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileFormatInfo {
  /** Human-readable language/format label, e.g. "TypeScript", "YAML" */
  label: string;
  /** Canonical file extension including the dot, e.g. ".ts", ".yaml" */
  extension: string;
  /** Language identifier for editor tooling hints */
  language: string;
  /** MIME type for export/download */
  mimeType: string;
}

// ─── Format map ───────────────────────────────────────────────────────────────

const FORMAT_INFO: Record<SourceFormat, FileFormatInfo> = {
  [SOURCE_FORMAT.JSON]:       { label: "JSON",        extension: ".json", language: "json",       mimeType: "application/json" },
  [SOURCE_FORMAT.YAML]:       { label: "YAML",        extension: ".yaml", language: "yaml",       mimeType: "text/yaml" },
  [SOURCE_FORMAT.TOML]:       { label: "TOML",        extension: ".toml", language: "toml",       mimeType: "text/toml" },
  [SOURCE_FORMAT.XML]:        { label: "XML",         extension: ".xml",  language: "xml",        mimeType: "application/xml" },
  [SOURCE_FORMAT.PYTHON]:     { label: "Python",      extension: ".py",   language: "python",     mimeType: "text/x-python" },
  [SOURCE_FORMAT.TYPESCRIPT]: { label: "TypeScript",  extension: ".ts",   language: "typescript", mimeType: "text/typescript" },
  [SOURCE_FORMAT.JAVASCRIPT]: { label: "JavaScript",  extension: ".js",   language: "javascript", mimeType: "text/javascript" },
  [SOURCE_FORMAT.SHELL]:      { label: "Shell",       extension: ".sh",   language: "shellscript",mimeType: "text/x-shellscript" },
  [SOURCE_FORMAT.SQL]:        { label: "SQL",         extension: ".sql",  language: "sql",        mimeType: "text/x-sql" },
  [SOURCE_FORMAT.HTML]:       { label: "HTML",        extension: ".html", language: "html",       mimeType: "text/html" },
  [SOURCE_FORMAT.CSS]:        { label: "CSS",         extension: ".css",  language: "css",        mimeType: "text/css" },
  [SOURCE_FORMAT.PLAIN_TEXT]: { label: "Plain text",  extension: ".txt",  language: "plaintext",  mimeType: "text/plain" },
  [SOURCE_FORMAT.MARKDOWN]:   { label: "Markdown",    extension: ".md",   language: "markdown",   mimeType: "text/markdown" },
  [SOURCE_FORMAT.BINARY]:     { label: "Binary",      extension: ".bin",  language: "binary",     mimeType: "application/octet-stream" },
};

// ─── Extension → format map ───────────────────────────────────────────────────

const EXTENSION_TO_FORMAT: Record<string, SourceFormat> = {
  ".json":  SOURCE_FORMAT.JSON,
  ".yaml":  SOURCE_FORMAT.YAML,
  ".yml":   SOURCE_FORMAT.YAML,
  ".toml":  SOURCE_FORMAT.TOML,
  ".xml":   SOURCE_FORMAT.XML,
  ".py":    SOURCE_FORMAT.PYTHON,
  ".ts":    SOURCE_FORMAT.TYPESCRIPT,
  ".tsx":   SOURCE_FORMAT.TYPESCRIPT,
  ".js":    SOURCE_FORMAT.JAVASCRIPT,
  ".jsx":   SOURCE_FORMAT.JAVASCRIPT,
  ".mjs":   SOURCE_FORMAT.JAVASCRIPT,
  ".sh":    SOURCE_FORMAT.SHELL,
  ".bash":  SOURCE_FORMAT.SHELL,
  ".zsh":   SOURCE_FORMAT.SHELL,
  ".sql":   SOURCE_FORMAT.SQL,
  ".html":  SOURCE_FORMAT.HTML,
  ".htm":   SOURCE_FORMAT.HTML,
  ".css":   SOURCE_FORMAT.CSS,
  ".txt":   SOURCE_FORMAT.PLAIN_TEXT,
  ".md":    SOURCE_FORMAT.MARKDOWN,
  ".mdx":   SOURCE_FORMAT.MARKDOWN,
};

// ─── Supported formats for file creation UI (excludes binary and markdown) ────

export const CREATABLE_FILE_FORMATS: SourceFormat[] = [
  SOURCE_FORMAT.JSON,
  SOURCE_FORMAT.YAML,
  SOURCE_FORMAT.TOML,
  SOURCE_FORMAT.XML,
  SOURCE_FORMAT.PYTHON,
  SOURCE_FORMAT.TYPESCRIPT,
  SOURCE_FORMAT.JAVASCRIPT,
  SOURCE_FORMAT.SHELL,
  SOURCE_FORMAT.SQL,
  SOURCE_FORMAT.HTML,
  SOURCE_FORMAT.CSS,
  SOURCE_FORMAT.PLAIN_TEXT,
];

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Returns display metadata for a SourceFormat value.
 * Falls back to plain_text if the format is unrecognised.
 */
export function getFormatInfo(format: SourceFormat): FileFormatInfo {
  return FORMAT_INFO[format] ?? FORMAT_INFO[SOURCE_FORMAT.PLAIN_TEXT];
}

/**
 * Detects the SourceFormat from a filename by examining its extension.
 * Returns null if no matching extension is found.
 */
export function detectFormatFromFilename(filename: string): SourceFormat | null {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return null;
  const ext = filename.slice(lastDot).toLowerCase();
  return EXTENSION_TO_FORMAT[ext] ?? null;
}

/**
 * Extracts the file extension from a filename, e.g. ".json".
 * Returns null if the filename has no extension or starts with a dot.
 */
export function extractFileExtension(filename: string): string | null {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return null;
  return filename.slice(lastDot).toLowerCase();
}
