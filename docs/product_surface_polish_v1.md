# Product surface polish — V1

This document captures the visual hierarchy, language, navigation, mobile, and
accessibility rules applied during the V1 polish pass. Later prompts must
preserve these rules.

---

## Navigation labels and icons

| Nav item | Label | Icon |
|---|---|---|
| Workspace home | Home | Home |
| Global search | Search | Search |
| Workspace manager | Workspaces | LayoutGrid |
| Write proposals | Proposals | Inbox |
| Workspace audit log | Audit log | ClipboardList |
| Settings | Settings | Settings |

**Rule**: Use "Workspaces" (plural) not "Workspace" in the nav. The `LayoutGrid`
icon signals "overview of all boxes" — not `Archive`. The `Archive` icon is
reserved for the archived/trashed lifecycle state, not a nav destination.

---

## Page title consistency

Each route uses `PageHeader` (from `src/components/product/page_header.tsx`)
with a `title` that matches its nav label exactly where possible.

| Route | PageHeader title |
|---|---|
| `/app` | (custom header — workspace name as h1) |
| `/app/workspaces` | Workspaces |
| `/app/search` | Search |
| `/app/proposals` | Write proposals |
| `/app/audit` | Audit log |
| `/app/settings` | Settings |
| `/app/boxes/[id]` | (custom header — box name as h1) |
| `/app/notes/[id]` | (breadcrumb + title in editor) |

**Rule**: Do not use `PageHeader` on the box and note pages — they have custom
headers with breadcrumbs and action toolbars. All other routes use `PageHeader`.

---

## Product language glossary

These are the canonical terms used across all UI copy, labels, and descriptions.
Do not introduce synonyms.

| Term | Definition | Do not say |
|---|---|---|
| **Box** | A focused context domain | Project, folder, container |
| **Folder** | Optional structural grouping inside a box | Directory, category |
| **Note** | Markdown content — the primary unit of context | Document, page, file |
| **Guide note** | One note per box that orients AI retrieval | Box guide, orientation note |
| **Context bundle** | A bounded retrieval package assembled from a note and its linked context | Export package, context package |
| **Explicit link** | A directed semantic relationship between two notes | Backlink, related note, connection |
| **Connection** | An authenticated external agent or integration | API key, integration, agent |
| **Proposal** / **Write proposal** | A machine-generated note change awaiting human review | Change request, diff |
| **Archive** / **Unarchive** | Reversible hide — content excluded from active views | Disable, deactivate, hide |
| **Trash** / **Restore** | Pending deletion — excluded from retrieval | Delete, remove |
| **Read hint** | A retrieval signal that guides how AI uses a note | Usage hint, instruction |
| **Document mode** | The rendered-markdown reading surface in the note editor | Preview, read mode |
| **Markdown mode** | The raw-source editing surface in the note editor | Edit mode, source mode |
| **Generated note** | A note created by an external connection | AI note, machine note |
| **Promoted** | A generated note taken into human ownership | Adopted, converted |

---

## Lifecycle action language

| Action | Label | Icon |
|---|---|---|
| Archive note | "Archive note" | Archive |
| Unarchive note | "Unarchive note" | ArchiveRestore |
| Move to trash | "Move to trash" | Trash2 |
| Restore from trash | "Restore from trash" | RotateCcw |
| Archive box (cascade) | "Archive box" | Archive |
| Unarchive box | "Unarchive box" | ArchiveRestore |
| Archive folder (subtree) | "Archive subtree" | Archive |
| Unarchive folder (subtree) | "Unarchive subtree" | ArchiveRestore |
| Move folder to trash | "Move subtree to trash" | Trash2 |
| Restore folder from trash | "Restore subtree from trash" | RotateCcw |

All destructive actions (trash) require a two-step inline confirmation before
executing. Archive actions do not require confirmation.

---

## Badge and status system

### Note kind badges

Shown in the note top bar (breadcrumb row) and in the right panel Identity section.

| Kind | Badge style | Icon |
|---|---|---|
| `note` | No badge (default, implicit) | — |
| `guide` | Amber: `border-amber-300/60 bg-amber-50/60 text-amber-700 dark:...` + BookOpen | BookOpen |
| `bundle` | `variant="secondary"` | — |

**Rule**: Never show both an uppercase eyebrow label AND a kind badge for the
same field. Use the badge only for non-default kinds (guide, bundle).

### Note status badges

Shown on mobile (< lg) in the metadata strip below the top bar.

| Status | Badge | Icon |
|---|---|---|
| `active` | No badge | — |
| `archived` | `variant="secondary"` + "Archived" | Archive |
| `trashed` | `variant="secondary"` + destructive text + "Trash" | Trash2 |

### Box status badges

Shown in the box page header (breadcrumb row) and box right panel Identity section.

| Status | Badge |
|---|---|
| `active` | No badge |
| `archived` | `variant="secondary"` + "Archived" |

### Generated / promoted badges

| State | Badge style | Icon |
|---|---|---|
| Generated (unpromoted) | `variant="outline"` + "Generated" | Bot |
| Guide note (in top bar) | Amber treatment | BookOpen |

---

## Panel section label style

Section labels inside right panels (box panel, note panel) and `PanelSection`:

```
text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60
```

This is the canonical label eyebrow style. All panel section headers use this.
Do not mix `text-xs` and `text-[10px]` for the same role across panels.

---

## Right panel structure

### Note right panel tabs (288px, hidden < lg)

| Tab | Contents |
|---|---|
| Info | Kind badge → title → summary → retrieval signals → tags → location → machine origin → version |
| Links | Context relationships (outgoing / incoming) |
| Bundle | Context bundle viewer |
| History | Version timeline + rollback |

**Rule**: All tab content areas use `px-4 py-3` wrapper padding inside the
ScrollArea. Do not use `px-3`.

### Box right panel sections (288px, hidden < lg)

1. Guide note (amber card or dashed callout) + GuideNotePicker
2. Box identity (name, description, status)
3. Contents (folder count, note count)
4. Folder policies (AI write policies)
5. Details (created date, slug)

---

## Mobile behavior

The right panel (`lg:flex`) is not shown on mobile. The following information
is surfaced on mobile as a substitute:

### Note page mobile metadata strip

Shown below the top bar on `< lg` screens when any of these are true:
- Note kind is not "note"
- Note status is "archived" or "trashed"
- Note has tags

Displays: kind badge (with amber style for guide), status badge, up to 3 tags.

**Rule**: Do not show the metadata strip when all values are default (kind=note,
status=active, no tags) — it would be empty.

---

## Accessibility rules

### Lifecycle menus (MoreHorizontal trigger)

- Trigger button: `aria-label="[Entity] actions"`, `aria-expanded={open}`, `aria-haspopup="menu"`
- Dropdown container: `role="menu"`, `aria-label="[Entity] actions"`
- All action buttons: `role="menuitem"`

### Breadcrumbs

- Wrap in `<nav aria-label="Breadcrumb">`
- Use `aria-current="page"` on the last/current item if it is non-interactive

### Form sections in settings

All section ID anchors use the section label, not a technical key:
- `/app/settings#settings-profile`
- `/app/settings#settings-appearance`
- `/app/settings#settings-notifications`
- `/app/settings#settings-connections`
- `/app/settings#settings-security`

### Empty interactive clickable areas

- All icon-only buttons have an `aria-label`
- All links in breadcrumbs have descriptive content

---

## Sidebar rules

- The "Workspaces" nav item navigates to `/app/workspaces` (the workspace
  manager / box list page). It uses `LayoutGrid` icon.
- The `Archive` icon is **never** used as a nav icon — it is reserved for the
  archive lifecycle state.
- Both `AppSidebar` (desktop) and `MobileSidebar` (sheet drawer) maintain
  identical nav items, labels, icons, and href targets.
- `MobileSidebar` auto-closes on navigation (`onClick={close}` on all links).

---

## Rules for future prompts

1. **Nav labels are plural nouns** — "Workspaces", "Proposals", "Audit log"
2. **Archive icon ≠ nav** — `Archive` is lifecycle-only; use `LayoutGrid`, `LayoutList`, or `Grid3x3` for collection views
3. **Kind badges only for non-default** — never show "Note" badge since it is the default kind
4. **Panel content padding is `px-4 py-3`** — applies inside right panel tab containers
5. **Lifecycle menus have full ARIA** — `aria-expanded`, `aria-haspopup`, `role="menu"`, `role="menuitem"`
6. **Mobile metadata strip** — shown on note pages for non-default kind/status/tags; must be `lg:hidden`
7. **Settings anchors use label IDs** — `#settings-connections` not `#settings-api`
8. **PageHeader on all top-level routes** — except box and note pages which have custom headers
