"use client";

import { useMemo } from "react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { json, jsonParseLinter } from "@codemirror/lang-json";
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
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { go } from "@codemirror/legacy-modes/mode/go";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { r as rLang } from "@codemirror/legacy-modes/mode/r";
import { c, cpp, csharp, java, kotlin, scala } from "@codemirror/legacy-modes/mode/clike";
import { linter, lintGutter } from "@codemirror/lint";
import { autocompletion } from "@codemirror/autocomplete";
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
 * - Autocompletion is language-native (keywords + local tokens + syntax).
 *   It is NOT AI-assisted — we do not send content to any model.
 * - Lint markers are enabled for JSON (built-in parser). Other languages
 *   fall back to parse-time highlighting only.
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
  | "binary"
  | "rust"
  | "go"
  | "ruby"
  | "swift"
  | "perl"
  | "lua"
  | "haskell"
  | "erlang"
  | "dockerfile"
  | "r"
  | "c"
  | "cpp"
  | "csharp"
  | "java"
  | "kotlin"
  | "scala";

/**
 * Return the CodeMirror language extensions (zero or more) for a given
 * canonical format. Returned list also includes the lint extension when
 * the language supports structural linting.
 */
function extensionsForFormat(format: string): Extension[] {
  switch (format) {
    case "html":
      return [html({ autoCloseTags: true })];
    case "json":
      // JSON has a real parser-based linter — show red squigglies for
      // syntactically invalid JSON.
      return [json(), linter(jsonParseLinter())];
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
    case "rust":
      return [StreamLanguage.define(rust)];
    case "go":
      return [StreamLanguage.define(go)];
    case "ruby":
      return [StreamLanguage.define(ruby)];
    case "swift":
      return [StreamLanguage.define(swift)];
    case "perl":
      return [StreamLanguage.define(perl)];
    case "lua":
      return [StreamLanguage.define(lua)];
    case "haskell":
      return [StreamLanguage.define(haskell)];
    case "erlang":
      return [StreamLanguage.define(erlang)];
    case "dockerfile":
      return [StreamLanguage.define(dockerFile)];
    case "r":
      return [StreamLanguage.define(rLang)];
    case "c":
      return [StreamLanguage.define(c)];
    case "cpp":
      return [StreamLanguage.define(cpp)];
    case "csharp":
      return [StreamLanguage.define(csharp)];
    case "java":
      return [StreamLanguage.define(java)];
    case "kotlin":
      return [StreamLanguage.define(kotlin)];
    case "scala":
      return [StreamLanguage.define(scala)];
    case "plain_text":
    case "binary":
    default:
      // No language extension — plain text editing
      return [];
  }
}

/**
 * Map a file extension (with or without leading dot) to a canonical
 * format. Covers every format in the `SourceFormat` union.
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
    case "pyi":
      return "python";
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return "shell";
    case "sql":
      return "sql";
    case "css":
    case "scss":
    case "sass":
    case "less":
      return "css";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "txt":
    case "log":
      return "plain_text";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "rb":
      return "ruby";
    case "swift":
      return "swift";
    case "pl":
    case "pm":
      return "perl";
    case "lua":
      return "lua";
    case "hs":
      return "haskell";
    case "erl":
      return "erlang";
    case "dockerfile":
    case "containerfile":
      return "dockerfile";
    case "r":
    case "rdata":
      return "r";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cxx":
    case "cc":
    case "hpp":
    case "hxx":
      return "cpp";
    case "cs":
      return "csharp";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "scala":
    case "sc":
      return "scala";
    default:
      return null;
  }
}

/**
 * Build the static theme extension once. Using a fresh object each
 * render caused CodeMirror to tear down and re-create its editor
 * state, producing the brief reflow observed during theme toggles.
 * Hoisted to module scope so it is stable across renders.
 */
const staticThemeExtension = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    height: "100%",
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
  ".cm-lintRange-error": {
    backgroundImage:
      "linear-gradient(45deg, transparent 66%, var(--color-destructive) 66%, var(--color-destructive) 100%)",
    backgroundSize: "4px 3px",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "bottom",
  },
});

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
  /** Placeholder content when value is empty. */
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

  // Extensions depend on format only. The theme (light vs dark) flips via
  // a separate `theme` prop — not inside the extension array — which is
  // what prevents the editor state from being rebuilt on theme toggle.
  const extensions = useMemo<Extension[]>(() => {
    return [
      EditorView.lineWrapping,
      staticThemeExtension,
      lintGutter(),
      autocompletion({
        // Language-native completions only. We do NOT wire an AI
        // completion source here — source suggestions come from the
        // language's own grammar and the document's own tokens.
        activateOnTyping: true,
        closeOnBlur: true,
        defaultKeymap: true,
      }),
      ...extensionsForFormat(effectiveFormat),
    ];
  }, [effectiveFormat]);

  // Reference the lang modules so bundlers include them (side-effects of
  // importing the language packages are what register the highlighters).
  void javascriptLanguage;
  void typescriptLanguage;

  // Theme resolution: oneDark object in dark mode, "light" string otherwise.
  // Both values are stable references (oneDark is a module-level export,
  // "light" is a string literal) so the CodeMirror wrapper only does a
  // cheap swap rather than a full editor rebuild when theme changes.
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
          autocompletion: false, // we configure our own above, keep basicSetup off
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
