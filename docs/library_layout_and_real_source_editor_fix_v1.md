# Library layout and real source editor — V1

This document describes the April 2026 corrective pass that fixed two
production-facing issues:

1. The Agents and Skills library pages used a narrow centered column,
   so one or two cards appeared floating in a large empty canvas.
2. Files, Skill source, and Agent source were all rendered as plain
   `<textarea>` elements with no syntax highlighting, making HTML,
   JSON, YAML, Python, and other formats look like raw text.

Both are fixed here with real product implementations — not just CSS
tweaks.

---

## 1. Library page layout

### What was wrong

`src/app/app/skills/page.tsx` and `src/app/app/agents/page.tsx` wrapped
the card grid in `mx-auto max-w-3xl px-6 py-6`. `max-w-3xl` caps the
column at 768px, so on a 1440px laptop display the grid only filled
the middle third of the content area. Empty states were centered
vertically and horizontally in a giant blank canvas.

### What changed

Both pages now use:

```tsx
<div className="mx-auto w-full max-w-7xl px-6 py-6">
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    …cards…
  </div>
</div>
```

- `max-w-7xl` (1280px) so the grid uses real screen real estate.
- Responsive breakpoints: 1 column on mobile, 2 columns at `sm`, 3 at
  `lg`, 4 at `xl`.
- A count header (`N skill(s)` / `N agent(s)`) sits above the grid so
  even a single item reads as an intentional library surface, not a
  floating card.

### Empty states

Empty states previously used `flex-1 items-center justify-center py-16`
which centered them in the middle of the page. They now render a
left-aligned, bordered, dashed-outline card explaining what goes
there, anchored at the top of the content area. Works the same whether
you have zero, one, or many items.

### Headers

The existing page headers (Skills / Agents titles plus action buttons)
were already anchored correctly. Actions (`New skill`, `Import skill`,
`New agent`, `Import agent`) remain in the page header row.

### Coherence

Both pages use the exact same container, grid, empty-state, and header
patterns so they feel like a single coherent library surface.

---

## 2. Real source editor for Files, Skill source, and Agent source

### What was wrong

Every editing surface in the repo was a plain HTML `<textarea>` with
`font-mono text-sm`. HTML, JSON, YAML, XML, Python, TypeScript, SQL,
and shell files all rendered as colorless monospaced text with no
highlighting, no bracket matching, no indentation guides. Skill and
Agent canonical sources had the same fallback.

### Editor choice: CodeMirror 6

We added CodeMirror 6 via `@uiw/react-codemirror`. CodeMirror 6 is:

- Lightweight (~100KB gzipped core, modular language packs)
- Tree-shakable — each language is its own package
- Native React support via `@uiw/react-codemirror`
- Production-grade: used by GitHub, Chrome DevTools, Observable, Jupyter
- Fully accessible, works with screen readers, supports keyboard-only users

Installed packages:

```
@uiw/react-codemirror
@codemirror/state
@codemirror/view
@codemirror/commands
@codemirror/language
@codemirror/lang-html
@codemirror/lang-json
@codemirror/lang-javascript   (covers JavaScript + TypeScript)
@codemirror/lang-python
@codemirror/lang-yaml
@codemirror/lang-xml
@codemirror/lang-sql
@codemirror/lang-markdown
@codemirror/lang-css
@codemirror/legacy-modes       (covers shell, toml)
@codemirror/theme-one-dark
```

### Shared abstraction: `<SourceEditor>`

`src/components/product/source_editor.tsx` is the single source-editing
component used by Files, Skills, and Agents. It:

- Accepts `value`, `onChange`, `format`, and optional `fileExtension`.
- Picks the CodeMirror language extension based on `format`
  (preferring a recognized extension-derived format if the stored
  `canonical_format` is `plain_text`).
- Applies a light or dark theme from `next-themes` automatically.
- Exposes `isDirty` via `data-editor-dirty` on its root wrapper so
  the realtime layer (`WorkspaceLiveRefresh`) continues to defer
  refreshes during active editing.
- Keeps autosave logic in the caller — the editor is purely a
  controlled surface. This preserves the two-second debounce,
  retry-on-error flow, and save-state UI that were already in place.

Format-to-language mapping lives in a single `extensionsForFormat`
switch inside the component. Formats supported today:

| Format | CodeMirror mode |
| --- | --- |
| `html` | `@codemirror/lang-html` with auto-close tags |
| `json` | `@codemirror/lang-json` |
| `javascript` | `@codemirror/lang-javascript` with JSX |
| `typescript` | `@codemirror/lang-javascript` with JSX + TS |
| `python` | `@codemirror/lang-python` |
| `yaml` | `@codemirror/lang-yaml` |
| `xml` | `@codemirror/lang-xml` |
| `sql` | `@codemirror/lang-sql` |
| `markdown` | `@codemirror/lang-markdown` (source editing only) |
| `css` | `@codemirror/lang-css` |
| `shell` | `@codemirror/legacy-modes/shell` |
| `toml` | `@codemirror/legacy-modes/toml` |
| `plain_text`, `binary` | no language extension |

Extension inference also maps `.py` → python, `.sh` → shell, etc., so a
File stored with `canonical_format: 'plain_text'` but named `foo.py`
still gets Python highlighting.

### File editor

`src/components/product/file_editor.tsx` now renders
`<SourceEditor ... />` instead of a textarea. File metadata (name,
format badge, line count) and autosave logic are unchanged — only the
editing surface was replaced. The `data-editor-dirty` attribute flows
through.

### Skill source editor

`src/components/product/skill_source_editor.tsx` now renders
`<SourceEditor ... />`. The outer card wrapper sets
`min-h-[420px]` so the editor has a concrete height even inside a
ScrollArea parent. Markdown-format Skills still use **source editing**
(not a document preview) — this preserves the product rule that only
Notes get readable document presentation.

### Agent source editor

`src/components/product/agent_source_editor.tsx` now renders
`<SourceEditor ... />`. Same design: real language-aware source
editing for every supported canonical format. Markdown Agents still
use source editing, not document rendering.

### Markdown is NOT document-rendered

Markdown is in the language map because Skill and Agent sources can
be markdown. The SourceEditor renders it as **markdown source with
syntax highlighting** (headings, lists, code fences highlighted as
markdown tokens). It never switches to a document preview. This
preserves the rule that document presentation is exclusive to Notes.

### Notes are untouched

The Note editor has its own document-style editing experience and is
not affected by this change. The shared `<SourceEditor>` is for Files,
Skills, and Agents only.

### Performance and realtime

- CodeMirror is imported from the `"use client"` component and only
  loaded client-side.
- `data-editor-dirty` on the wrapper lets `WorkspaceLiveRefresh`
  continue to defer page refresh while editing is in progress.
- Autosave debounce and retry logic are unchanged — editor type swap
  is independent of save flow.
- Tests verified: all 209 vitest unit and integration tests continue
  to pass.

---

## Files changed

| File | Change |
| --- | --- |
| `src/components/product/source_editor.tsx` | **New** — shared CodeMirror-based editor with per-format language extensions and extension-derived format inference. |
| `src/components/product/file_editor.tsx` | Replaced the `<textarea>` with `<SourceEditor>`. Autosave, metadata, and toolbar unchanged. |
| `src/components/product/skill_source_editor.tsx` | Replaced the `<textarea>` with `<SourceEditor>`. Added `min-h-[420px]` on the card wrapper so the editor has a concrete height. |
| `src/components/product/agent_source_editor.tsx` | Replaced the `<textarea>` with `<SourceEditor>`. Autosave and toolbar unchanged. |
| `src/app/app/skills/page.tsx` | Library layout: `max-w-7xl` container, 1→4 responsive column grid, count header, redesigned left-aligned empty state. |
| `src/app/app/agents/page.tsx` | Same pattern — matches Skills. |
| `package.json` / `pnpm-lock.yaml` | Added `@uiw/react-codemirror` plus CodeMirror core and language packs. |
| `docs/library_layout_and_real_source_editor_fix_v1.md` | This document. |

---

## Remaining limitations

1. **No in-editor autocomplete suggestions yet.** CodeMirror supports
   language-specific completion providers; we chose to leave
   `autocompletion: false` in the initial rollout to avoid introducing
   AI-like behavior. Enabling it per-language is a small follow-on.
2. **No linting or error markers** inside the editor. Adding `lint`
   extensions (e.g., the `@codemirror/lint` package) is a follow-on.
3. **File extensions beyond the included language list** fall back to
   plain-text mode. The list covers every format in
   `SKILL_AGENT_FORMATS` plus files&rsquo; full canonical format
   enum. Unusual extensions (`.dart`, `.rs`, etc.) still edit fine,
   just without highlighting.
4. **Theme switch is resolved via `next-themes`**; users who toggle
   theme while actively editing will see the editor re-theme without
   losing content or cursor position, but there is a brief reflow.
