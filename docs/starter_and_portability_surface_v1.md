# Starter and portability surface — V1

This document describes the first-run onboarding strategy, template surface
principles, import and export UX principles, empty state system, and how
portability is surfaced as a first class workflow.

Later prompts must preserve the rules described here.

---

## Purpose

Context Store should feel complete and productive from the first minute. The
starter and portability surfaces exist to:

1. Teach the mental model without marketing language
2. Make import and export feel like core workflows, not settings utilities
3. Guide first actions toward structured starting points (templates, guide notes)
4. Ensure empty states guide action rather than expose blankness

---

## Onboarding strategy

### Trigger condition

The `OnboardingCallout` is shown on the workspace home when `boxes.length === 0`.
It is a server component with no client state — the workspace state is the
source of truth for when it appears.

### What is taught

Six core concepts are taught in a 2×3 grid:

1. **Box** — focused context domain
2. **Folder** — optional organizational structure (no retrieval semantics)
3. **Note** — primary unit of context (Markdown)
4. **Guide note** — orients retrieval; read first by AI agents
5. **Explicit links** — directed semantic relationships between notes (not backlinks)
6. **Context bundle** — bounded retrieval package from a note + linked context

### Starter paths offered

The onboarding footer provides two things:

1. **Primary CTA**: "Create your first box" via `CreateBoxDialog`. The dialog
   includes an optional template picker (Project context template). The CTA
   copy mentions the template name so users know it exists.

2. **Import hint**: A secondary note at the bottom:
   "Have existing notes? Create a box first, then use the Import button in the
   box header to bring in .md files or .zip packages."

### Design rules

- Do not use marketing language
- Do not create a long wizard or progress tracker
- Do not auto-dismiss — the callout disappears when a box is created
- Teach the product identity, not features

---

## Quick start panel

### Trigger condition

The `QuickStartPanel` is shown on the workspace home when `boxes.length > 0`
AND `allNotes.length === 0` (boxes exist but contain no notes yet). It is a
server component.

### What it shows

A single card with a link to the first box and three instructional starter
actions:

1. **Import existing content** — explains Import button location (box header)
2. **Start from a note template** — explains New note → template flow
3. **Create a guide note** — explains guide note assignment via context panel

### Design rules

- Links to the first box page (where the full action surface lives)
- Does not duplicate dialogs from the box page (no embedded Import or Create Note)
- Disappears once notes exist (no persistent tutorial overlay)
- Guide note entry uses amber icon styling (`text-amber-600/70`) — consistent
  with guide note amber treatment throughout the product

---

## Template surface principles

### What templates are

Templates are structured starting points, not generic scaffolding. They encode
product-appropriate patterns for real context work:

| Template | Kind | Use |
|---|---|---|
| Project context (box) | Box template | Creates 5 folders + 5 notes with guide note assigned |
| Prompt template | Note | Structured prompt definition with inputs, outputs, usage |
| Agent template | Note | Role, objective, rules, tools, failure modes, trust |
| System template | Note | Constraints, invariants, retrieval hints, update policy |
| Guide note | Note (guide) | Box front door; orients AI retrieval |

### Where templates appear

**Box templates** appear in `CreateBoxDialog`. One template exists (Project context).

**Note templates** appear in `CreateNoteDialog` as a dropdown (Blank note or one of four templates).

### Rules

- Do not add a visual template marketplace or builder
- Templates are code-defined and deterministic — no user-defined templates in V1
- Template application calls normal service functions (versioning, audit preserved)
- Template language aligns with the product thesis — not generic productivity
- Guide note template uses `kind: "guide"` and `read_hint: "read_first"`

---

## Import UX principles

### Where import is available

| Surface | Entry point |
|---|---|
| Box page | `ImportTriggerButton` in box header — always visible |
| Workspace home (no boxes) | `OnboardingCallout` import hint (text, not a button) |
| Workspace home (has boxes, no notes) | `QuickStartPanel` first action explains it |

Import requires a target box. The workspace home therefore guides users to
the box page rather than offering a standalone import dialog.

### What import communicates

The `ImportDialog` (modal) clearly presents:

1. **File selection** — .md or .zip, with file size display
2. **Collision mode** — 4 options with descriptions:
   - Create copy (safe default — never overwrites)
   - Replace by ID (updates matching IDs in place)
   - Merge metadata only (preserves body, merges summary/tags)
   - Remap IDs and import (fresh IDs, rewrites references)
3. **Target folder** — optional folder within the box
4. **Import summary** — after completion, shows created/replaced/skipped counts,
   warnings, and a collapsible action log

### Rules

- Preserve collision modes — do not simplify to one mode
- Import summary must be clear and reviewable
- Never auto-select a destructive collision mode
- Import is always box-scoped (no cross-box import)

---

## Export UX principles

### Where export is available

| Surface | Entry point |
|---|---|
| Note page | `NoteExportMenu` (note and context bundle options) |
| Box page | `BoxExportMenu` (box and folder options) |
| Any box/note page | Embedded in header action row |

### What each export communicates

| Export | Description shown |
|---|---|
| Export note | "Markdown file + export manifest with note metadata — signed link valid 1 hour" |
| Export context bundle | "Note + linked context + guide note if assigned + README — signed link valid 1 hour" |
| Export box | "All notes, folders, semantic links, and manifest — signed link valid 1 hour" |
| Export folder | "This folder and all descendant notes — signed link valid 1 hour" |

### Signed link delivery

All exports are delivered via signed Supabase Storage URLs. The link expiration
(1 hour) is communicated in every export option description. Users should copy
or download promptly.

### Rules

- Do not expose raw storage paths or bucket URLs
- Do not remove the signed link expiry mention from descriptions
- Export menu is always local — no server-side download tracking UI needed
- The manifest (`export.json`) is always included in every export package

---

## Empty state system

### Principles

1. Empty states should suggest the next useful action
2. Empty states should use the `EmptyState` component for visual consistency
3. Empty states should teach the product model where appropriate
4. Empty states should feel embedded — not detached or decorative

### Surfaces and their empty states

| Surface | Empty state |
|---|---|
| Workspace home (no boxes) | `OnboardingCallout` — teaches mental model, offers Create Box CTA |
| Workspace home (boxes but no notes) | `QuickStartPanel` — explains import, template, guide note actions |
| Box Notes tab (no notes) | EmptyState: "Create your first note, choose a starter template, or use the Import button above" |
| Box Tree tab (empty box) | Inline text: "No content yet. Use New folder or New note above, or Import to bring in existing Markdown files." |
| Box Search (no query) | "Type to search notes in this box." |
| Box Search (no results) | "No notes found for [query]." |
| Box guide note (none assigned) | Dashed callout in context panel: explains guide note purpose, shows GuideNotePicker |
| Proposals (no pending) | CircleDashed empty state with explanation of what proposals are |
| Connections (none) | Dashed border empty state explaining what connections do |
| Audit events (none / filtered) | "No audit events found" + filter clearing hint |

---

## Guide note starter reinforcement

### Where guide note creation is encouraged

1. **Box context panel (right pane)** — Always the first section. When no guide is
   assigned, a dashed callout explains the purpose and shows `GuideNotePicker`.
2. **Box header strip** — When no guide: "No guide note — assign one in the box
   context panel" (muted text).
3. **`QuickStartPanel`** — Third action explains creating a guide note for new boxes.
4. **`OnboardingCallout`** — Guide note is taught as one of the six core concepts.
5. **Note templates** — The "Guide note" starter template is the fourth option in
   `CreateNoteDialog`, clearly labeled for boxes lacking a guide.

### Rules

- Do not auto-assign guide notes
- Do not create warning spam ("Your box has no guide note!") — the missing state
  is visible but calm
- Guide note amber styling (`text-amber-600/70`) is used in the QuickStartPanel
  to maintain visual consistency with the amber treatment elsewhere

---

## Rules for future prompts

1. **OnboardingCallout teaches 6 concepts** — Box, Folder, Note, Guide note,
   Explicit links, Context bundle. Do not remove Explicit links (added in this prompt).
2. **Import hint is in the onboarding footer** — not a separate button or dialog;
   the callout text explains the two-step flow (create box → import).
3. **QuickStartPanel is server-only** — no client state; links to box page.
4. **Export descriptions include signed link expiry** — all four export options
   must mention "signed link valid 1 hour" or similar.
5. **Empty states use `EmptyState` component** — do not build one-off centered
   layouts with different visual treatment.
6. **Templates are code-defined** — do not add a builder or user-defined templates.
7. **Import is always box-scoped** — no workspace-level import in V1.
8. **The Project context template label is always used by name** — "Project context"
   is the canonical label referenced in the onboarding footer copy.
