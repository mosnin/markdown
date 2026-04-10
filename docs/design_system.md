# Design system

Context Store uses shadcn/ui as the component foundation, extended with a deliberate token system and product-level components. The design direction is inspired by Apple Human Interface Guidelines — not as a visual template, but as a quality standard.

**Quality constraints from HIG:**
- Clear visual hierarchy at every level
- Visual calm — no decoration that does not carry information
- Restrained spacing and motion
- Consistency across all components
- Premium but minimal feel

---

## Color tokens

All color values are defined as CSS custom properties in `src/app/globals.css`.

### Surface tokens

Surfaces layer from deepest (sunken) to highest (overlay).

| Token | Use |
|---|---|
| `--surface-base` | Page background |
| `--surface-raised` | Cards, panels |
| `--surface-overlay` | Popovers, dropdowns, modals |
| `--surface-sunken` | Code blocks, input backgrounds, muted wells |

Use the utility classes `surface-base`, `surface-raised`, `surface-overlay`, `surface-sunken`.

### Text hierarchy tokens

| Token | Use |
|---|---|
| `--text-primary` | Headings, primary labels |
| `--text-secondary` | Body text, descriptions |
| `--text-tertiary` | Supporting metadata |
| `--text-placeholder` | Input placeholder text |
| `--text-disabled` | Disabled states |
| `--text-inverse` | Text on dark/primary backgrounds |

Use the utility classes `text-primary-label`, `text-secondary-label`, `text-tertiary-label`.

### Border tokens

| Token | Use |
|---|---|
| `--border-subtle` | Dividers, hairline separators |
| `--border-default` | Card borders, input borders |
| `--border-strong` | Focused/active borders |

---

## Radius scale

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4px | Badge, chip, tight component |
| `--radius-sm` | 6px | Input, small button |
| `--radius-md` | 8px | Card, panel |
| `--radius-lg` | 12px | Modal, sheet |
| `--radius-xl` | 16px | Large card |
| `--radius-full` | 9999px | Pill / avatar |

---

## Shadow scale

Use shadow sparingly. Elevation should communicate structure, not decoration.

| Token | Use |
|---|---|
| `--shadow-xs` | Hover state lift on interactive rows |
| `--shadow-sm` | Card default |
| `--shadow-md` | Focused/active card |
| `--shadow-lg` | Dropdown, popover |
| `--shadow-xl` | Modal |

---

## Motion timing

All transitions use the `--ease-standard` curve (material-style decelerate) by default.

| Token | Duration | Use |
|---|---|---|
| `--duration-instant` | 80ms | State changes that should feel immediate (checkbox, toggle) |
| `--duration-fast` | 150ms | Hover states, color transitions |
| `--duration-normal` | 200ms | Panel transitions, button feedback |
| `--duration-slow` | 300ms | Sheet, dialog open/close |
| `--duration-deliberate` | 500ms | Page-level layout shifts |

Utility classes: `transition-fast`, `transition-standard`.

**Do not animate things that do not need animation.** Color changes on hover use `transition-fast`. Layout changes use `transition-standard` or `transition-slow`. Never use CSS transitions on text content.

---

## Typography

Context Store uses Geist Sans (variable) and Geist Mono.

### Scale

| Class | Size | Weight | Use |
|---|---|---|---|
| `text-2xl font-semibold tracking-tight` | 24px | 600 | Page titles (rare) |
| `text-xl font-semibold tracking-tight` | 20px | 600 | Page header `h1` |
| `text-base font-semibold` | 16px | 600 | Card titles, section heads |
| `text-sm font-medium` | 14px | 500 | Labels, nav items, buttons |
| `text-sm` | 14px | 400 | Body text, descriptions |
| `text-xs font-medium uppercase tracking-wider` | 12px | 500 | Section eyebrows, metadata labels |
| `text-xs` | 12px | 400 | Supporting metadata, captions |

### Rules

- Use `tracking-tight` on headings above 18px only
- Use `uppercase tracking-wider` only for eyebrow labels and section dividers
- Avoid bold weights for body text — use `font-medium` instead
- Line-height defaults (`leading-normal`) are correct for body. Use `leading-relaxed` for prose paragraphs.

---

## Spacing rhythm

Context Store uses a 4px base grid. The standard spacing scale is: 4, 8, 12, 16, 20, 24, 32, 40, 48.

### Component-level rules

| Context | Padding |
|---|---|
| Sidebar nav item | `px-2.5 py-2` |
| Card body | `px-4 py-3.5` |
| Page header | `px-6 pt-6 pb-4` |
| Panel section label | `px-4 pb-2` |
| Panel section content | `px-4` |
| Main content column | `px-6 py-6` |
| Max content width | `max-w-3xl` for lists, `max-w-2xl` for note body |

---

## Component conventions

### shadcn primitives (`src/components/ui/`)

Do not modify shadcn files directly. Compose them into product components.

Installed primitives:
`button` `input` `textarea` `card` `badge` `separator` `scroll-area` `sheet` `dialog` `dropdown-menu` `tabs` `tooltip` `skeleton`

### Product components (`src/components/product/`)

| Component | Purpose |
|---|---|
| `AppShell` | Root layout: sidebar + main + optional right panel |
| `AppSidebar` | Left navigation rail with expandable workspace tree |
| `AppHeader` | Top command bar (breadcrumbs, toolbar) |
| `MobileSidebar` | Sheet-based left drawer for mobile; mirrors sidebar tree |
| `TreeSidebar` | Expandable box/folder/note tree (client); lazy-loads via `getBoxTreeAction` |
| `PageHeader` | Per-page title, description, and action slot |
| `EmptyState` | Consistent empty list/view message |
| `PanelSection` | Labeled section for panels and detail views |
| `NoteEditor` | Two-mode note editor: Document (rendered) / Markdown (editable raw source) |
| `AutosaveStatus` | Subtle autosave indicator (idle/unsaved/saving/saved/error) for note toolbar |
| `SemanticLinksPanel` | Context relationships panel (outgoing + incoming, with relationship_note annotations) |
| `GraphPanel` | Server wrapper for box graph tab: stats, truncation warning, renders BoxGraphView |
| `BoxGraphView` | Interactive read-only graph: hierarchy canvas + semantic link rows + node detail |
| `RetrievalHintBadge` | Compact display of `read_hint` + `retrieval_priority` signals; renders nothing when unset |
| `DashboardSection` | Section wrapper for the workspace cockpit home |
| `DashboardCard` | Card component (link or static) for the cockpit |
| `NoteStub` | Note card for list and search views |
| `NoteStubSkeleton` | Loading state for NoteStub |
| `ThemeProvider` | next-themes wrapper |
| `ThemeToggle` | Light/dark toggle |
| `ProposalsPanel` | Write proposal review queue: type-aware content preview, approve/reject flow |
| `NoteHistoryPanel` | Immutable version timeline with rollback; two-pane list + detail |
| `AuditPanel` | Append-only workspace activity journal with actor/object filters |
| `ConnectionsPanel` | Access control surface: connection cards, permission modes, box scopes |
| `GeneratedNoteBanner` | Provenance banner for generated notes; promote-to-standard action |
| `OnboardingCallout` | First-run mental model callout (no boxes); 6 concepts + Create Box + import hint |
| `QuickStartPanel` | Sparse workspace starter panel (boxes but no notes); 3 guided actions |
| `ImportDialog` / `ImportTriggerButton` | Import modal with file upload, collision mode picker, summary panel |
| `NoteExportMenu` | Note-surface export dropdown: note export + context bundle export |
| `BoxExportMenu` | Box-surface export dropdown: box export + folder export |
| `NoteLifecycleMenu` | Note archive/unarchive/trash/restore actions; inline two-step confirm for destructive ops |
| `BoxLifecycleMenu` | Box archive/unarchive actions; inline confirm |
| `FolderLifecycleMenu` | Folder subtree archive/unarchive/trash/restore; inline confirm |
| `BoxContentsTree` | Static hierarchical folder/note tree for box Tree tab (server component) |
| `GuideNotePicker` | Guide note assignment control: select or clear guide note for a box |
| `BoxGuidePanel` | Guide tab content: rendered guide note with outgoing links |
| `FolderPolicyToggle` | Per-folder AI write policy toggle (`accepts_generated_notes`) |

### Three-pane workspace layout

Desktop layout uses a fixed three-pane model:

```
[left sidebar 240px] | [center pane flex-1] | [right context pane 288px]
```

The right pane is hidden below `lg` breakpoint. It is embedded in page components (not
in `AppShell`) so the shell stays thin and pages own their panel space.

On mobile (< md), the left sidebar becomes a full-height sheet drawer triggered by a
hamburger button in a top bar. The right pane is hidden on mobile — its content is
accessible via right-panel tabs in the note and box pages.

### Context intelligence surfaces

The right pane is a context intelligence surface — not a utility drawer. Its purpose is
to make the current note or box feel situated in a structured knowledge system.

**Note right pane tabs:**

| Tab | Contents |
|---|---|
| Info | Guide callout (if applicable), kind, summary, retrieval signals, location, machine origin, version |
| Links | Semantic context relationships (outgoing / incoming) with relationship_note annotations |
| Bundle | Context bundle: bounded retrieval package with assembly options |
| History | Immutable version timeline with rollback |

**Info tab section order:** guide callout → identity → summary → retrieval signals → tags → location → machine origin → version. Empty sections are hidden.

**Box right pane:**

Guide note is always the first section (front door). Sections: guide note card + picker → box identity → contents stats → folder policies → details.

**Guide note color treatment:** always amber (`border-amber-300/60 bg-amber-50/40` light, `border-amber-600/40 bg-amber-900/10` dark). Used consistently across the guide note card, chips in the graph, badges in breadcrumbs, and the Info tab callout.

**Retrieval signals (`RetrievalHintBadge`):** `retrieval_priority` shown as `p1`, `p2`, … in a monospace pill. `read_hint` shown as italic text (known values normalized). Renders nothing when both are unset.

See [docs/context_intelligence_surface_v1.md](context_intelligence_surface_v1.md) for the full specification.

### Note editor modes

The `NoteEditor` component exposes **two modes** via a toolbar toggle:

| Mode | Description |
|---|---|
| Document | Rendered markdown — the default human reading surface |
| Markdown | Editable raw markdown textarea, labeled "the exact source the AI model receives" |

**Document mode** is the default when opening a note. Clicking anywhere in the document
or focusing the title switches to Markdown mode automatically.

**Markdown mode** is the editing and inspection surface. The stored markdown string and
the textarea content are identical — no transformation, no conversion. A subtle banner
confirms this is the AI-facing source. Metadata editing (summary, tags, read hint) is
available in a collapsible section at the bottom of the Markdown mode surface.

There is no separate read-only "Source" mode. Markdown mode is both the editing surface
and the source inspection surface. See [docs/note_dual_view_and_autosave_v1.md](note_dual_view_and_autosave_v1.md).

### Autosave save state

The `AutosaveStatus` component displays save state in the note toolbar:

| State | Visual | Meaning |
|---|---|---|
| `idle` | (nothing) | No changes since last save |
| `unsaved` | `● Unsaved` (dim) | Content changed; autosave timer running |
| `saving` | `⟳ Saving…` | Save in flight |
| `saved` | `✓ Saved` | Last save succeeded (fades to idle after 4s) |
| `error` | `⊘ error` | Save failed; Retry button appears |

### Semantic links framing

Note links are **explicit semantic context relationships**, not backlinks. Always use:
- Section title: "Context relationships"
- Outgoing: "This note →"
- Incoming: "→ Referred by"

Do not label them "Linked notes", "Backlinks", or "Related notes".

### Naming

- Product components use `snake_case` filenames and `PascalCase` export names
- This visually separates product components from shadcn primitives in imports and file listings
- Do not use barrel files — import from the specific module

---

## Badge system

Use `Badge` from `src/components/ui/badge` for all status, kind, and metadata chips. Do not build one-off inline badge layouts.

### Kind badges

| Kind | Variant | Treatment |
|---|---|---|
| `note` | No badge | Default — never show a "Note" badge |
| `guide` | `secondary` | Amber: `border-amber-300/60 bg-amber-50/60 text-amber-700 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-400` + BookOpen icon |
| `bundle` | `secondary` | No special color |

### Lifecycle status badges

| Status | Variant | Icon |
|---|---|---|
| `active` | No badge | — |
| `archived` | `secondary` | Archive icon |
| `trashed` | `secondary` + destructive text | Trash2 icon |

### Generated / machine origin

| State | Variant | Icon |
|---|---|---|
| Generated (unpromoted) | `outline` | Bot |

### Proposal type badges

Handled by `ProposalsPanel`; see trust_workspace_surface_v1.md.

### Connection status badges

Handled by `ConnectionsPanel`; see trust_workspace_surface_v1.md.

---

## Mobile metadata strip (note page)

When the right panel is hidden (`< lg` breakpoint), a compact metadata strip
appears below the note top bar. It surfaces the minimum context needed to orient
the reader on a small screen:

- **Kind badge** (only for guide/bundle — not for default "note" kind)
- **Status badge** (only for archived/trashed — not for active)
- **Tags** (up to 3)

```tsx
{(note.kind !== "note" || note.status === "archived" || ...) && (
  <div className="flex items-center gap-2 flex-wrap border-b border-border px-6 py-1.5 lg:hidden">
    ...
  </div>
)}
```

The strip is hidden when all values are default (kind=note, status=active, no tags).

---

## Dark mode

Dark mode is implemented via `next-themes` with the `class` attribute strategy.
The `.dark` class on `<html>` activates the dark palette.

All color tokens have both light and dark values defined in `globals.css`.
Use Tailwind semantic tokens (`bg-background`, `text-foreground`, `border-border`, etc.) — never hardcode light/dark-specific colors in components.

---

## What not to do

- Do not add decorative illustrations or gradients
- Do not use color for branding (the palette is neutral by design)
- Do not animate layout shifts or content
- Do not use `font-bold` in UI chrome — reserve it for editorial content
- Do not add shadows to elements that do not need elevation
- Do not use `rounded-full` on rectangular content blocks
- Do not mix spacing values outside the 4px grid
