# Files as a First-Class Object Type

This document specifies the Files object, its editor surface, metadata panel, lifecycle, and how it differs from Notes.

---

## What a File is

A **File** is a non-markdown code or data artifact stored in a box. It is typed by a `canonical_format` (e.g. `json`, `python`, `typescript`, `yaml`) and optionally carries a file extension.

Files are **not** documents. There is no prose view, no rich text, and no markdown rendering. A file is always displayed in its raw source form.

Files live in the same box/folder hierarchy as Notes, participate in the same version history and semantic link system, and are indexed in `workspace_objects` for graph and retrieval operations.

---

## Domain model

### Database table: `files`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK | |
| `box_id` | uuid FK | |
| `folder_id` | uuid FK nullable | |
| `name` | text | Base name without extension |
| `file_extension` | text nullable | Stored with leading dot (e.g. `.json`) |
| `canonical_format` | text | `SOURCE_FORMAT` enum value |
| `source_language` | text nullable | Language hint for syntax context |
| `mime_type` | text nullable | |
| `source_content` | text | Raw file content |
| `content_bytes` | int | Byte count of `source_content` (auto-maintained by trigger) |
| `description` | text nullable | Human description |
| `summary` | text nullable | AI-generated summary |
| `tags` | text[] | |
| `status` | text | `draft` \| `active` \| `archived` \| `trashed` |
| `origin_type` | text | `user_created` \| `imported` \| `generated` |
| `current_version_id` | uuid nullable | Points to `object_versions` |
| `path_cache` | text nullable | Denormalized path string |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Source format enum (`SOURCE_FORMAT`)

| Value | Label | Extension |
|---|---|---|
| `json` | JSON | `.json` |
| `yaml` | YAML | `.yaml` |
| `toml` | TOML | `.toml` |
| `xml` | XML | `.xml` |
| `python` | Python | `.py` |
| `typescript` | TypeScript | `.ts` |
| `javascript` | JavaScript | `.js` |
| `shell` | Shell | `.sh` |
| `sql` | SQL | `.sql` |
| `html` | HTML | `.html` |
| `css` | CSS | `.css` |
| `plain_text` | Plain text | `.txt` |
| `markdown` | Markdown | `.md` |
| `binary` | Binary | — |

`markdown` and `binary` are excluded from the create UI (`CREATABLE_FILE_FORMATS`). `markdown` content is a Note concern; `binary` cannot be edited in a textarea.

---

## File creation

### Entry points

1. **Box quick-create dropdown** — "New file" item in `BoxQuickCreateMenu` within `TreeSidebar`
2. **Box detail page** — "New file" button (future)
3. **Import flow** — recognized non-markdown file formats are created as Files automatically

### `FileCreateDialog`

Fields:
- **Filename** (required) — monospace input; extension is auto-detected live via `detectFormatFromFilename`. Validates: non-empty, max 255 chars, no slashes.
- **Source format** (select) — auto-populated from filename extension; manually overridable.
- **Initial content** (optional textarea) — monospace; pre-populated on import.

After creation: navigate to `/app/files/[file_id]`.

Controlled mode: pass `open` + `onOpenChange` props. The dialog is then opened externally (e.g. from a tree sidebar dropdown). No trigger button is rendered.

### `createFileInBoxAction`

Server action in `src/app/app/files/actions.ts`:
1. Validates filename and ownership of box
2. Calls `createFile` service → `create_object_with_initial_version` RPC
3. `revalidatePath(/app/boxes/${boxId})`
4. Returns `{ ok: true, data: { id } }`

---

## File editor

### Route

`/app/files/[file_id]` — full-page route at `src/app/app/files/[file_id]/page.tsx`

### Layout

```
[top bar: breadcrumb + status badges + History link + More menu]
[center: FileEditor (textarea, fills remaining height)]
[right aside: FileContextPanel (hidden lg:flex, w-72)]
```

The right pane is only visible at `lg` breakpoint and above. On mobile, the context panel is hidden entirely in this version.

### `FileEditor` component

Located at `src/components/product/file_editor.tsx`. Client component.

**Toolbar (top of editor):**
- Left: `FileLanguageBadge` + line count
- Right: `AutosaveStatus` + Retry button on error

**Code textarea:**
```
font-mono text-sm leading-6
spellCheck={false}
autoCorrect="off"
autoCapitalize="off"
data-gramm="false"
```

There is **no mode toggle**, **no preview**, and **no document view**. Files are always raw source.

**Autosave behavior:**
- `AUTOSAVE_DEBOUNCE_MS = 2000` (vs 1500 for Notes — code edits are often followed by more keystrokes)
- State machine: `"idle" | "unsaved" | "saving" | "saved" | "error"`
- `isSavingRef` guard prevents concurrent saves
- `lastSavedContent` ref prevents no-op saves when content matches last saved state
- On navigation (file.id or current_version_id changes): cancel pending timers, reset state

**Save action:** `saveFileAction` → `updateFileContent` → `update_object_and_create_version` RPC. Max content length: 500,000 bytes.

---

## Notes vs Files: clear distinction

| Dimension | Note | File |
|---|---|---|
| Format | Always markdown | Typed: json, python, typescript, etc. |
| Editor | Document + Markdown modes | Code textarea only |
| Purpose | Human prose, documentation | Code and data artifacts |
| Rich text | Yes (rendered markdown) | No |
| Syntax highlighting | No (not planned) | No (no library dependency; raw textarea) |
| AI source | The exact markdown body | The exact source content |
| Bundle tab | Yes | No |
| Links | `note_links` (note↔note) + `object_links` | `object_links` only |

**Do not blur these types.** Notes are not files; files are not notes. The UI must make this distinction clear through consistent labeling and presentation.

---

## File metadata panel

`FileContextPanel` — right pane at `lg` breakpoint.

### Tabs

#### Info

Sections (in order, empty sections hidden):
1. Status banner — only when `archived` or `trashed`
2. Identity — `file.name` (monospace) + `file.description`
3. Format — `FileLanguageBadge` + extension + mime type
4. Size — bytes or KB
5. Tags — if any
6. Summary — if any (AI-generated)
7. Location — workspace → box → folder breadcrumb, `path_cache` if set
8. Version — current version UUID (first 8 chars), created date, last updated relative date, origin if not `user_created`

#### Links

`FileObjectLinksPanel`:
- Outgoing section: "This file →" — relationships this file initiates
- Incoming section: "→ Referred by" — relationships pointing to this file
- Add link dialog: picks from notes and files in the same box (separated by optgroup)
- Relationship types: same 10-value vocabulary as note semantic links
- Calls `createFileObjectLinkAction` / `deleteFileObjectLinkAction`

#### History

Immutable list of `ObjectVersion` records (most recent first, capped at 50):
- Version number (`v1`, `v2`, …)
- Relative date
- `change_origin` if not `human_edit`

No rollback in this version.

---

## File lifecycle

States: `draft → active → archived → trashed`

`FileLifecycleMenu` (top bar "More" button):
- **Active/Draft:** Archive | Move to trash (with confirmation)
- **Archived:** Unarchive | Move to trash
- **Trashed:** Restore

Lifecycle mutations call `updateFileStatusAction` → `updateFile` repository. No `revalidatePath` — `router.refresh()` is called client-side after success.

Status is shown as a badge in the top bar when the file is archived or trashed.

---

## Semantic links

Files participate in `object_links` (not `note_links`). An `object_link` record has:
- `source_object_type` / `source_object_id`
- `target_object_type` / `target_object_id`
- `relationship_type` — one of 10 values (same vocabulary as note semantic links)
- `relationship_note` — optional free text annotation

`createLink` in `object_link_service` validates that both endpoints exist in `workspace_objects` (same workspace). Files are registered there on creation, so this works.

Currently supported link endpoints: file↔note, file↔file, file↔skill (display only), file↔agent (display only).

---

## Format detection

`src/lib/file_format_utils.ts` provides:

- `detectFormatFromFilename(filename: string): SourceFormat | null` — maps extension to SourceFormat
- `extractFileExtension(filename: string): string | null` — returns extension including leading dot
- `getFormatInfo(format: SourceFormat): FileFormatInfo` — returns `{ label, extension, language, mimeType }`
- `CREATABLE_FILE_FORMATS` — `SourceFormat[]` excluding `binary` and `markdown`

Extension map (representative entries):
`.json → json`, `.yaml/.yml → yaml`, `.toml → toml`, `.xml → xml`, `.py → python`, `.ts/.tsx → typescript`, `.js/.jsx/.mjs → javascript`, `.sh/.bash/.zsh → shell`, `.sql → sql`, `.html/.htm → html`, `.css → css`, `.txt → plain_text`

---

## `FileLanguageBadge`

`src/components/product/file_language_badge.tsx`

Compact inline badge displaying the canonical format label:

```
border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground
```

Props: `format`, `extension?`, `className?`, `showExtension?`

Used in: file editor toolbar, file context panel Info tab.

---

## Versioning

File saves go through `update_object_and_create_version` RPC which atomically:
1. Updates `files.source_content` and `files.updated_at`
2. Inserts a new `object_versions` row with the previous content snapshot
3. Updates `files.current_version_id`

This is the same RPC used for skill and agent edits. Note edits use a parallel `update_note_and_create_version` RPC.

Maximum stored versions per file: determined by RPC implementation (currently uncapped, list is capped at 50 in the history panel).

## Branch-aware writes (v1.1)

Files are now branch-aware. When a draft branch is active,
`saveFileAction` routes through `updateFileContentOnBranch` (a thin
wrapper around the shared `updateObjectContentOnBranch` helper
exported from `src/server/services/object_branch_service.ts`),
which writes a new immutable `object_versions` row and upserts
`branch_heads`. The canonical `files` row is never touched until
promote.

Branch reads: `getFileForWorkspace(.., branchId)` patches
`source_content`, `content_bytes`, and `current_version_id` from
the branch head when one exists. Non-versioned fields (name,
description, tags, summary, status, canonical_format) remain on
main — they are not carried on the branch in V1.

A shared `ActiveBranchBannerServer` component at the top of the
file page signals the branch context. Promote walks file heads
inside the same change set the rollback engine already restores.
See
[`docs/branch_aware_writes_v1.md`](branch_aware_writes_v1.md).
