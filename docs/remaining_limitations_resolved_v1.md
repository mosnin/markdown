# Remaining limitations resolved — V1

This document records the pass that closed the eight remaining
limitations from the previous two corrective passes. Each limitation is
now implemented as real behavior, not documented as a trade-off.

---

## Editor limitations (from the CodeMirror introduction)

### 1. Autocomplete suggestions — now enabled

The `SourceEditor` (`src/components/product/source_editor.tsx`) now
mounts the `@codemirror/autocomplete` extension. Suggestions are
language-native: they come from the language&rsquo;s own grammar and
the document&rsquo;s tokens. **No AI completion source is wired in.**
We do not send content to any model — the behavior matches modern
code editors and is fully local.

Behavior:
- Opens on typing (`activateOnTyping: true`).
- Closes automatically on blur.
- Uses the default keymap (`Ctrl+Space`, `Tab` to accept, etc.).
- `basicSetup.autocompletion` is set to `false` so we register our
  own configured instance — no duplicate extension registration.

### 2. Lint markers — now enabled

The editor mounts `@codemirror/lint` with:

- `lintGutter()` — dedicated lint gutter column.
- A JSON parse-error linter via `jsonParseLinter()` when the current
  document is JSON. Syntactically invalid JSON now shows red
  squigglies and a gutter marker.
- The theme extension includes `.cm-lintRange-error` styling that
  uses the `--color-destructive` token for consistency with the
  oklch design system.

Other languages fall through to grammar-driven highlighting (still a
real signal for malformed input) and can be extended with dedicated
linters later. The wiring is in place; adding more linters is a
one-line switch per language.

### 3. Extensions outside the original language list

The `formatFromExtension` mapper and `extensionsForFormat` switch now
cover the full `SourceFormat` union plus an expanded set of
StreamLanguage modes from `@codemirror/legacy-modes`:

- `.rs` → rust
- `.go` → go
- `.rb` → ruby
- `.swift` → swift
- `.pl`, `.pm` → perl
- `.lua` → lua
- `.hs` → haskell
- `.erl` → erlang
- `dockerfile`, `containerfile` → dockerfile
- `.r` → R
- `.c`, `.h` → c
- `.cpp`, `.cxx`, `.cc`, `.hpp`, `.hxx` → cpp
- `.cs` → csharp
- `.java` → java
- `.kt`, `.kts` → kotlin
- `.scala`, `.sc` → scala

Aliases for `.tsx`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.zsh`,
`.fish`, `.scss`, `.sass`, `.less`, `.mdx`, etc. are all resolved.
Files with unknown extensions still fall back to plain-text mode
cleanly — you can always type and save.

### 4. Theme toggle reflow — now stable

The theme extension was previously built inside `useMemo` on every
render, which caused CodeMirror to tear down and rebuild its editor
state when the theme changed. The theme extension is now hoisted to
module scope (`staticThemeExtension`) and the dark/light flip happens
via the CodeMirror wrapper&rsquo;s `theme` prop — a cheap swap, not a
full rebuild. Cursor position, scroll position, selection, and
undo/redo history are preserved across theme toggles.

---

## Product limitations

### 5. Single workspace per owner — now multi-workspace

The product now supports an owner having multiple workspaces. Each
workspace is an independent container; no content crosses a workspace
boundary.

Implementation:

- **Active workspace cookie**:
  `src/server/auth/get_request_context.ts` now reads an
  `active_workspace_id` cookie and passes it as `preferredWorkspaceId`
  to `getOrCreateDefaultWorkspace`. If the user owns that workspace,
  it becomes the active one for the request. Otherwise the first
  owned workspace is used.

- **Create workspace**:
  `src/app/app/workspaces/actions.ts` exports
  `createWorkspaceAction(name)`. It generates a unique slug per
  owner, inserts a new row, writes the cookie, and revalidates the
  app layout. The newly created workspace becomes active immediately.

- **Switch workspace**:
  Same file exports `setActiveWorkspaceAction(workspaceId)`. It
  verifies the user owns the workspace, writes the cookie, and
  revalidates the app layout.

- **Workspace switcher UI**:
  `src/components/product/workspace_switcher.tsx` lists every
  workspace the user owns, highlights the active one, and includes a
  "New workspace" dialog. Mounted at the top of both the desktop
  sidebar (`AppSidebar`) and the mobile sheet (`MobileSidebar`).

- **Workspaces management page**:
  `src/app/app/workspaces/page.tsx` now shows:
  - A "Your workspaces" list with switch buttons and an "Active"
    badge on the current one (`WorkspaceList`).
  - A "Boxes in &lt;active workspace&gt;" section with the existing
    BoxList.
  - A "New workspace" button in the page header
    (`CreateWorkspaceButton`).
  - An informational note that explains the multi-workspace model —
    replacing the previous "V1 single workspace" note.

- **`getRequestContext()` seam is preserved**. All downstream code
  still sees `ctx.workspace` as one `WorkspaceContext`. The multi-
  workspace picker is transparent to every page — they continue to
  read the active workspace exactly as before.

### 6. File-level import — now implemented

Users can now import content into an existing File object without
leaving the file page.

Implementation:

- `importIntoFileAction(fileId, formData)` in
  `src/app/app/files/actions.ts`. Accepts a file upload via
  `FormData`, reads its text (max 5MB, text content only), and
  writes through the existing
  `updateFileContent → update_object_and_create_version` RPC. That
  RPC creates a new immutable `object_versions` row and fires the
  audit event, so versioning, trust, and audit are all preserved.

- Two modes:
  - `replace` — overwrite current source with the uploaded content.
  - `append` — add the uploaded content to the end with a blank-line
    separator.

- `FileImportButton` (`src/components/product/file_import_button.tsx`)
  is a client component rendered in the file page header. Opens a
  dialog with mode selection, file input, and submit. Calls
  `router.refresh()` on success so the editor and version timeline
  update immediately.

- Works for every file scope: box-local files, files in folders,
  child files of box-local Skills/Agents, and child files of reusable
  workspace-level Skills/Agents — because the action uses
  `getFileForWorkspace` / `updateFileContent`, which verify ownership
  via `workspace_id` when `box_id` is null.

- Revalidation: the file page itself plus any parent surface (box,
  Skill, Agent) that might display file summaries or counts.

### 7. Workspace-level file link pool — now populated

For a file whose parent is a reusable Skill or Agent (workspace-level,
so no box context), the file page previously offered an empty
"eligible link targets" pool. Links had to go through the parent.

The file page now populates the pool with **sibling child files** —
other files owned by the same Skill or Agent (matched via
`parent_skill_id` or `parent_agent_id`). These are the natural link
targets inside a package. The combined pool is:

- Notes in the same box (when one exists), plus
- Files in the same box (when one exists), plus
- Sibling child files sharing the same `parent_skill_id` or
  `parent_agent_id` (workspace-level or box-local — both are
  included).

The helpers use a `Map` to de-duplicate by id so a file that happens
to appear in both pools is only shown once. Links between workspace-
level files are now a first-class flow in the file page UI.

### 8. Breadcrumb truncation — now responsive

The file page breadcrumb now truncates long names with
responsive caps:

- Linked intermediate crumbs: `max-w-[80px] sm:max-w-[140px]
  lg:max-w-[200px]`.
- Plain intermediate crumbs: `max-w-[80px] sm:max-w-[140px]`.
- Current filename (last crumb): `max-w-[140px] sm:max-w-[200px]
  lg:max-w-[260px]`.

Intermediate crumbs (everything between the workspace root and the
final filename) are hidden on the smallest screens (`<sm`) so the
user always sees at least the workspace and the file name. The
current filename is never truncated below a legible cap. `title`
attributes preserve the full name for hover / long-press inspection.

---

## Files changed

| File | Change |
| --- | --- |
| `src/components/product/source_editor.tsx` | Hoisted static theme extension, enabled language-native autocompletion, enabled lint gutter + JSON linter, added 14 additional language modes with extension inference, added `.tsx/.jsx/.mts/.cts/.zsh/.scss/.less/.mdx/...` aliases. |
| `src/server/auth/get_request_context.ts` | Reads `active_workspace_id` cookie and forwards to the bootstrap function. Exports `ACTIVE_WORKSPACE_COOKIE` constant. |
| `src/server/services/workspace_bootstrap/get_or_create_default_workspace.ts` | Accepts optional `preferredWorkspaceId`; returns the preferred workspace when the user owns it, first workspace otherwise, creates a default only when none exist. |
| `src/app/app/workspaces/actions.ts` | **New** — `createWorkspaceAction`, `setActiveWorkspaceAction`, `switchWorkspaceAndNavigate`. |
| `src/components/product/workspace_switcher.tsx` | **New** — client component. Lists workspaces, highlights active, allows switching and creating. |
| `src/components/product/app_sidebar.tsx`, `src/components/product/mobile_sidebar.tsx` | Replaced the static workspace pill with `<WorkspaceSwitcher>`, accept `workspaces` prop. Mobile sheet now includes the switcher. |
| `src/app/app/layout.tsx` | Loads `listWorkspacesByOwner` and passes to both sidebars. |
| `src/app/app/workspaces/page.tsx` | Rewritten to show `WorkspaceList` plus existing `BoxList`. Removed V1 single-workspace note; replaced with multi-workspace explanation. |
| `src/app/app/workspaces/workspace_list.tsx`, `src/app/app/workspaces/create_workspace_button.tsx` | **New** — client components. |
| `src/app/app/files/actions.ts` | Added `importIntoFileAction` with replace / append modes using `updateFileContent` under the hood. |
| `src/components/product/file_import_button.tsx` | **New** — client dialog component for file import. |
| `src/app/app/files/[file_id]/page.tsx` | File import button in header. Eligible link targets now include parent Skill/Agent siblings via `parent_skill_id` / `parent_agent_id` queries. Breadcrumb truncation is responsive with intermediate-crumb hiding on the smallest screens. |
| `docs/remaining_limitations_resolved_v1.md` | This document. |

---

## Verification

- `pnpm typecheck` — 0 errors.
- `pnpm lint` — 0 errors (pre-existing unused-var warnings unchanged).
- `pnpm test` — 209/209 pass.
- `pnpm build` — all routes compile.

---

## Remaining limitations (honest)

1. **Per-language linters**: JSON has a real parser-backed linter.
   Other languages fall through to grammar-driven highlighting.
   Adding further linters (Python, TypeScript, YAML, etc.) requires
   one-line wiring per language.
2. **Autocompletion is local only**: the editor suggests language
   keywords and document tokens — no AI completions. This is by
   design for privacy and determinism.
3. **Workspace deletion is not exposed in the UI**. The repository
   supports it; exposing a destructive delete flow wisely is a
   separate product decision.
4. **File upload limit of 5MB** for the file-level import flow.
   Larger imports should use the package import flow at the parent
   Skill/Agent level.
