"use client";

import { useMemo } from "react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import {
  javascript,
  javascriptLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { useTheme } from "next-themes";
import { oneDark } from "@codemirror/theme-one-dark";
import { cn } from "@/lib/utils";

/**
 * Shared source editor for Files, Skill source, and Agent source.
 *
 * Wraps CodeMirror 6 via @uiw/react-codemirror. Callers pass the content,
 * an onChange handler, and a canonical format string. The component picks
 * the right CodeMirror language extension automatically.
 *
 * Design rules:
 * - This component is the single source-editing surface used by Files,
 *   Skills, and Agents. There is no separate textarea fallback.
 * - Markdown format still uses source editing, NOT document rendering —
 *   this component renders markdown as markdown source, preserving the
 *   Notes-only rule for readable document presentation.
 * - Autosave logic lives in the caller. This component is purely a
 *   controlled editor surface.
 * - The `data-editor-dirty` signal used by WorkspaceLiveRefresh to defer
 *   refresh during editing is forwarded via the wrapper div.
 */

export type SourceFormat =
  | "plain_text"
  | "json"
  | "yaml"
  | "toml"
  | "xml"
  | "python"
  | "typescript"
  | "javascript"
  | "shell"
  | "sql"
  | "html"
  | "css"
  | "markdown"
  | "binary";

function extensionsForFormat(format: string): Extension[] {
  switch (format) {
    case "html":
      return [html({ autoCloseTags: true })];
    case "json":
      return [json()];
    case "javascript":
      return [javascript({ jsx: true })];
    case "typescript":
      return [javascript({ jsx: true, typescript: true })];
    case "python":
      return [python()];
    case "yaml":
      return [yaml()];
    case "xml":
      return [xml()];
    case "sql":
      return [sql()];
    case "markdown":
      return [markdown()];
    case "css":
      return [css()];
    case "shell":
      return [StreamLanguage.define(shell)];
    case "toml":
      return [StreamLanguage.define(toml)];
    case "plain_text":
    case "binary":
    default:
      // No language extension — plain text editing
      return [];
  }
}

/**
 * Map a file extension (with or without leading dot) to a canonical
 * format, so Files detect their mode correctly even when the stored
 * `canonical_format` is `plain_text`.
 */
export function formatFromExtension(ext: string | null | undefined): SourceFormat | null {
  if (!ext) return null;
  const e = ext.toLowerCase().replace(/^\./, "");
  switch (e) {
    case "html":
    case "htm":
      return "html";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "xml":
      return "xml";
    case "py":
      return "python";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "sql":
      return "sql";
    case "css":
      return "css";
    case "md":
    case "markdown":
      return "markdown";
    case "txt":
      return "plain_text";
    default:
      return null;
  }
}

interface SourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Canonical format; may be combined with fileExtension for stronger detection. */
  format: string;
  /** Optional extension hint (e.g. ".py", "ts") to refine the language mode. */
  fileExtension?: string | null;
  readOnly?: boolean;
  disabled?: boolean;
  /** Marks the surrounding wrapper with `data-editor-dirty` so the realtime
   *  layer knows to defer refresh while the user is typing. */
  isDirty?: boolean;
  className?: string;
  /** Accessible name for screen readers. */
  ariaLabel?: string;
  /** Placeholder content when value is empty (rendered inside the gutter area). */
  placeholder?: string;
  /** Minimum editor height in pixels. Defaults to 300. */
  minHeight?: number;
  /** Whether the editor should fill the parent container height. */
  fillHeight?: boolean;
}

export function SourceEditor({
  value,
  onChange,
  format,
  fileExtension,
  readOnly = false,
  disabled = false,
  isDirty,
  className,
  ariaLabel,
  placeholder,
  minHeight = 300,
  fillHeight = true,
}: SourceEditorProps) {
  const { resolvedTheme } = useTheme();

  // Prefer the file extension when it resolves to a known mode; otherwise
  // fall back to the canonical format. This covers plain_text files that
  // have a real extension like .py or .sh.
  const effectiveFormat = useMemo(() => {
    const fromExt = formatFromExtension(fileExtension);
    if (fromExt && fromExt !== "plain_text") return fromExt;
    return format;
  }, [format, fileExtension]);

  const extensions = useMemo<Extension[]>(() => {
    const base: Extension[] = [
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "13px",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          height: fillHeight ? "100%" : "auto",
        },
        ".cm-scroller": {
          fontFamily: "inherit",
          lineHeight: "1.55",
          padding: "0.75rem 0",
        },
        ".cm-content": {
          padding: "0 0.5rem",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid var(--color-border)",
          color: "var(--color-muted-foreground)",
        },
        "&.cm-focused": {
          outline: "none",
        },
        ".cm-activeLine": {
          backgroundColor: "color-mix(in oklch, var(--color-accent) 30%, transparent)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "color-mix(in oklch, var(--color-accent) 30%, transparent)",
        },
      }),
      ...extensionsForFormat(effectiveFormat),
    ];
    return base;
  }, [effectiveFormat, fillHeight]);

  // Reference the lang modules so bundlers include them (side-effects of
  // importing the language packages are what register the highlighters).
  void javascriptLanguage;
  void typescriptLanguage;

  const theme = resolvedTheme === "dark" ? oneDark : "light";

  return (
    <div
      data-editor-dirty={isDirty ? "true" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        editable={!disabled && !readOnly}
        readOnly={readOnly}
        theme={theme}
        extensions={extensions}
        height={fillHeight ? "100%" : undefined}
        minHeight={`${minHeight}px`}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          searchKeymap: true,
          syntaxHighlighting: true,
          tabSize: 2,
        }}
        className="flex-1 overflow-auto"
      />
    </div>
  );
}
