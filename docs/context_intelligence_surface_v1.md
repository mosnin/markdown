# Context intelligence surface — V1

This document describes the context intelligence surface: the right pane system,
guide note front door behavior, semantic link presentation, precision search UX,
box guide and box overview distinctions, and context bundle presentation.

Later prompts must preserve the rules described here.

---

## Purpose

Context Store is a context operating system — not a generic notes app. The surfaces
described in this document make that visible to humans without clutter. The product
should feel like a structured retrieval environment where:

- The current note feels situated in larger context
- Machine-legible metadata is visible and inspectable
- Guide notes feel like the front door to a box
- Semantic links feel like structured relationships, not a backlink list
- Search feels precise and deterministic, not fuzzy or magical
- Context bundles feel like meaningful retrieval packages, not raw API dumps

---

## Right pane principles

The right pane is a **context intelligence surface** — not a utility drawer. Its
content should make the current note or box feel situated in a structured system.

### Note right pane — four tabs

| Tab | Purpose |
|---|---|
| **Info** | Note identity, summary, retrieval signals, location, machine origin, version |
| **Links** | Semantic context relationships (outgoing + incoming) |
| **Bundle** | Context bundle — bounded retrieval package for AI or human inspection |
| **History** | Immutable version timeline with rollback |

### Info tab section order

The Info tab is ordered by information importance, not by database column order:

1. **Guide note callout** (if this note is the guide) — amber banner, explains AI reads it first
2. **Identity** — kind badge, note title
3. **Summary** — shown prominently early, not buried at the bottom
4. **Retrieval signals** — `read_hint` + `retrieval_priority` only when set; explained inline
5. **Tags** — tag vocabulary
6. **Location** — path hierarchy (workspace › box › folder), monospace `path_cache`
7. **Machine origin** — shown only when `is_generated` is true; names the connection
8. **Version** — shortened version ID, relative date, change_origin when non-human

### Section display rules

- Sections that are empty (no summary, no tags, no retrieval signals) are hidden — don't
  show empty section headers
- Machine origin is only shown when `note.is_generated` is true — never for promoted notes
- The guide callout uses amber styling to match the guide note treatment throughout the UI
- Location shows the full breadcrumb path inline, not just box name

### Box right pane

The box right pane is headed "Box context" and has:

1. **Guide note** (at top — front door): shows the guide note card (clickable) with its
   summary, then the GuideNotePicker assignment control below it; or, if no guide, a
   dashed callout explaining what a guide note is + assignment control
2. **Box identity**: name, description, archived status
3. **Contents**: folder count, note count
4. **Folder policies**: which folders accept direct AI writes
5. **Details**: created date, slug

Guide note is always the first section in the box right pane. This reinforces its role
as the front door to the box.

---

## Guide note front door behavior

The guide note is the front door to a box. It is read first by AI agents when assembling
context for any note in the box. Humans should immediately know:

1. Whether a guide note exists for the current box
2. What it is called and what it says
3. How to open it with one click

### Box page — front door signals

**Header strip** (always visible): below the box name and description, a small strip shows:
- If guide exists: `📖 Guide — [note title]` — linked, with amber icon; clicking opens the guide note
- If no guide: `📖 No guide note — assign one in the box context panel` — muted

**Right pane** (first section): guide note card with title + summary, linked directly.
Assignment control appears below the card.

**Guide tab**: the `BoxGuidePanel` shows the guide note prominently with its summary and
retrieval signals at the top. This tab is the machine interpretation layer for the box.

**Search results**: the guide note is marked with an amber "Guide" badge when it appears
in search results.

**Graph view**: the guide note chip uses amber styling (`border-amber-300/70`, `bg-amber-50/60`).

### Note page — guide role signal

When viewing the guide note itself:
- An amber callout appears at the top of the right pane Info tab:
  "This is the guide note for [box name]"
  "AI agents read this note first when assembling context for this box."
- The top bar breadcrumb shows an amber "Guide" badge
- The guide badge in the breadcrumb uses amber color tokens to match

### Rules

- `boxes.guide_note_id` remains the canonical source of truth
- Do not silently assign guide notes
- Amber color tokens for guide are: `border-amber-300/60`, `bg-amber-50/40`, text `text-amber-700`
  (dark: `border-amber-600/40`, `bg-amber-900/10`, `text-amber-400`)
- Guide treatment is calm, not loud — no heavy border or animation

---

## Semantic links as context relationships

Note links are **explicit semantic context relationships** — not backlinks or generic navigation.

### Correct framing

- Section title: "Context relationships"
- Outgoing header: "This note →" (notes this note points to)
- Incoming header: "→ Referred by" (notes that point to this note)
- Empty state: explains bundle inclusion, not navigation
- Each link shows: relationship_type badge + linked note title + relationship_note annotation

### Relationship vocabulary (10 canonical types)

| Type | Display label |
|---|---|
| `related` | Related to |
| `depends_on` | Depends on |
| `parent_of` | Parent of |
| `child_of` | Child of |
| `reference_for` | Reference for |
| `extends` | Extends |
| `example_of` | Example of |
| `sibling_of` | Sibling of |
| `supersedes` | Supersedes |
| `derived_from` | Derived from |

### relationship_note annotation

The optional `relationship_note` field on each link is a free-text explanation of why
the two notes are connected. It is always shown below the relationship_type badge:

```
[Depends on]  Note B
  "Note B defines the schema that this implementation follows."
```

In the context bundle viewer, relationship annotations appear in a separate row with a
`border-t border-border/50` separator, in italic muted text.

### What links are NOT

- Not backlinks (the system does not auto-generate them from text mentions)
- Not navigation shortcuts (they are metadata for AI context, not breadcrumbs)
- Not bidirectional (outgoing and incoming are shown separately)

---

## Retrieval signals

Retrieval signals make the note's machine-legible metadata visible to humans.

### Components

**`RetrievalHintBadge`** (`src/components/product/retrieval_hint_badge.tsx`) — compact
display of `read_hint` + `retrieval_priority`. Renders nothing when both are unset.

- `retrieval_priority > 0`: shown as `p1`, `p2`, … in a monospace rounded pill
- `read_hint`: shown as italic text with known-value normalization:
  - `core_reference` → "Core reference"
  - `read_first` → "Read first"
  - `background` → "Background"
  - `supplemental` → "Supplemental"
  - Any other value shown as-is

### Where retrieval signals appear

- **Note right pane Info tab** — "Retrieval" section, shown only when `read_hint` or
  `retrieval_priority` is set; includes inline explanation of what each signal does
- **Box guide panel** — guide note card shows `RetrievalHintBadge` below the summary
- **Context bundle viewer** — high-priority notes in the bundle already show `read_hint`
  via their NoteCard component

### Special values

`core_reference` and `read_first` are the two values that make a note eligible as an
**ancestor summary note** in a context bundle (the first qualifying note found by walking
up the folder chain from the target note). These values have extra weight — the bundle
assembly prefers them over notes with other `read_hint` values.

---

## Box guide — machine interpretation layer

The **box guide** (rendered by `BoxGuidePanel`) is the structured orientation surface that
answers: "what is this box for and how should it be read?"

This is **not** the guide note itself — it is a panel that presents the box's structure
from a machine interpretation perspective.

### What it shows

1. **Preamble** — "Machine interpretation layer" label + explanation
2. **Structure summary** — active folders / active notes / total links
3. **Guide note** — the guide note card (amber styling, linked, with summary + retrieval signals)
4. **High-priority notes** — `retrieval_priority > 0`, with `p1`, `p2`, … badges
5. **Most referenced notes** — by incoming link count — likely structural/foundational
6. **Tag vocabulary** — top 12 tags by frequency
7. **AI write folders** — folders with `accepts_generated_notes = true`, with explanation

### How it differs from box overview and context bundle

| Surface | Shows | Purpose |
|---|---|---|
| Box guide | Structured interpretation: guide, priority, links, tags, policies | "What is this box about?" |
| Box overview (BoxOverviewPanel) | Flat hierarchy tree + edge list | Legacy overview display |
| Graph tab (BoxGraphView) | Interactive spatial hierarchy + semantic edge rows | Visual structure map |
| Context bundle | Bounded retrieval package for a specific note | AI context delivery |

---

## Precision search

The `BoxSearchPanel` is a precision retrieval tool, not a fuzzy search. It uses
Postgres FTS with explicit ranking (exact title match → prefix → `ts_rank_cd`).

### Search result cards

Each result shows:
- **Title** with icon (guide note uses BookOpen + amber)
- **Folder path** (monospace, from `path_cache` minus the note's own segment)
- **Summary snippet** (first 2 lines, no body excerpt — body search is FTS weighted C)
- **Tags** (up to 4)
- **Guide badge** (amber, when the result is the box's guide note)
- **AI badge** (when `note.is_generated`)
- **Kind badge** for bundle/guide when not already shown by the guide badge

### Search framing

The panel header reads "Precision search" with a sub-description: "Full-text search
across title, tags, summary, and body. Results are ranked — exact title matches appear first."

This framing is intentional — it sets expectations that:
1. Results are deterministic and ranked
2. The scope is this box only
3. The ranking is explained (exact match wins)

### Scope constraint

Search is always box-scoped. There is no cross-box mixing in V1. The workspace search
panel (`WorkspaceSearchPanel`) allows selecting a box, but still searches one box at a time.

---

## Context bundle presentation

The context bundle is a bounded, deterministic retrieval package centered on one target note.

### What it is

The bundle is assembled by `assembleContextBundle()` and answers: "what context does an AI
agent need to work with this note?" It contains:

1. Target note (always present)
2. Guide note (if assigned + option enabled)
3. Ancestor summary (first qualifying note walking up the folder hierarchy)
4. Linked notes (ranked by relationship importance + read_hint, bounded by limit)
5. Relationship edges (for linked notes only)
6. Version info
7. Assembly metadata (options used, limits, timestamps)

### How it differs from other surfaces

| What | Scope | Purpose |
|---|---|---|
| Context bundle | One note (bounded) | AI context delivery |
| Box guide | One box (structured) | Machine interpretation orientation |
| Box overview | One box (full hierarchy) | Legacy overview display |
| Semantic links panel | One note (all links) | Human relationship management |

### Relationship annotation in bundles

`BundleLinkedNote.relationship_note` is shown below the relationship_type badge in each
linked note card:

```
[Extends]  API Reference Guide
  /reference
  Brief summary of the guide...
  "This note implements the patterns defined in the reference guide."
```

The annotation is in a visually separated row (border-top, italic, muted) so it reads as
a contextual explanation rather than part of the note metadata.

### Assembly options

The OptionsBar lets users control:
- Include guide note (checkbox)
- Include ancestor summary (checkbox)
- Linked notes limit (1, 2, 3, 5, 7, or 10)

Re-assembly happens immediately on option change via `assembleContextBundleAction`.

---

## Machine workflow visibility

Machine-connected workflows are visible and inspectable without taking over the page.

### Generated note signals

When `note.is_generated` is true:
- **Top bar**: a "Generated" badge (Bot icon + outline style)
- **GeneratedNoteBanner**: appears between top bar and note editor, identifies the
  generating connection, offers "Promote to standard note"
- **Info tab — Machine origin section**: shows "Generated by [connection name]" with
  a brief explanation; visible only in the right pane when is_generated is true

After promotion, `is_generated` becomes false and all three signals disappear. The
`origin_type` field preserves provenance in the version info section.

### Change origin in version info

The Info tab version section shows `change_origin` when it is not `human_edit`:
- `import` → "Imported"
- `generated` → "AI generated"
- `proposal_approved` → "Proposal approved"
- `rollback` → "Rollback"
- `promotion` → "Promoted"

This makes the note's machine history visible without a trip to the History tab.

### AI write folder policies

The box right pane "Folder policies" section shows all folders with their
`accepts_generated_notes` toggle. The box guide panel "AI write folders" section
lists only the folders that have it enabled, with an explanation.

---

## Rules for future prompts

1. **Guide note is always the top section** of the box right pane — do not move it down.
2. **Guide note always uses amber styling** — `border-amber-300/60 bg-amber-50/40` (light),
   `border-amber-600/40 bg-amber-900/10` (dark). Do not change these to generic muted styles.
3. **Info tab section order must be preserved** — summary before tags, location before machine origin.
4. **RetrievalHintBadge renders nothing when both signals are unset** — do not show an empty retrieval section.
5. **Context relationships are not backlinks** — "This note →" and "→ Referred by", not "Links" or "Backlinks".
6. **REL_LABEL in context_bundle_viewer must match the 10-value canonical vocabulary** — never use old values (references, contradicts).
7. **relationship_note is always shown** — never hide it when set; it is a meaningful annotation.
8. **Search stays box-scoped** — do not add cross-box mixing to BoxSearchPanel.
9. **Search framing stays "Precision search"** — do not soften it to "Search" or "Find".
10. **Box guide, box overview, and context bundle are distinct surfaces** — never collapse or merge them.
11. **Machine origin section appears only when is_generated is true** — not for all notes.
12. **RetrievalHintBadge is the canonical display for read_hint + retrieval_priority** — reuse it; don't rebuild inline.
