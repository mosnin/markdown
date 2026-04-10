# Onboarding and templates V1

Product-native first-run guidance and lightweight template system.

---

## Onboarding strategy

### Goal

Teach the Context Store mental model on first contact, without a long wizard or
marketing-heavy splash screen. Users arrive from a magic link — they need to know
what to do next, not read a product tour.

### Trigger condition

The `OnboardingCallout` component renders on the home page (`/app`) only when
`boxes.length === 0`. Once any box exists, the callout is replaced by the normal
home page content (stat cards + recent notes).

### What it teaches

Six concepts in product-specific language (2×3 grid):

| Term | Description shown |
|---|---|
| **Box** | A focused context domain. One box per project, topic, or area of knowledge. |
| **Folder** | Optional structure inside a box. Folders organize notes — they don't change retrieval semantics. |
| **Note** | Markdown content with a title, tags, and optional summary. The primary unit of context. |
| **Guide note** | One note per box that orients retrieval. AI agents read this first. |
| **Explicit links** | Directed semantic relationships between notes. Connect context with a type and an explanation. Not backlinks. |
| **Context bundle** | A bounded retrieval package assembled from a note and its linked context. |

### Starter paths offered

The onboarding footer shows two things:

1. **Create your first box** — `CreateBoxDialog` CTA, with copy mentioning the
   "Project context" template as an option.
2. **Import hint** — Secondary text: "Have existing notes? Create a box first,
   then use the Import button in the box header to bring in .md files or .zip packages."

### Quick start panel

When `boxes.length > 0` but `allNotes.length === 0` (boxes exist but are empty),
`QuickStartPanel` is shown instead of `OnboardingCallout`. It links to the first
box and explains three starter actions:
1. Import existing content (Import button in box header)
2. Start from a note template (New note → template picker)
3. Create a guide note (context panel on right side)

### Design principles

- Server component — no client state, no dismiss tracking
- No cookie or database flag for "onboarding complete" — the workspace state is the source of truth
- Lightweight: one callout card, then the normal product surface takes over
- Action-oriented: the callout ends with a `CreateBoxDialog` trigger + import hint
- Not marketing copy — language stays precise and product-appropriate

### Where it lives

```
src/components/product/onboarding_callout.tsx   OnboardingCallout (server component)
src/app/app/page.tsx                            Renders OnboardingCallout when !hasBoxes
```

---

## Template system

### Goal

Give users structured starting points for common box types and note kinds. Templates
encode product-appropriate patterns (guide note + folders + starting content), not
generic document templates.

### Template scope

Templates are **productivity helpers inside the app** — they don't expose new product
capabilities. Applying a template calls the same service functions that any user action
would call: `createFolder`, `createNote`, `assignGuideNote`. Templates do not bypass
versioning, audit, or ownership checks.

### Template types

#### Box templates

Applied when creating a box. Creates folders and notes with initial content,
sets `read_hint` on each note at creation time, and optionally assigns a guide note.

| Template | Folders | Notes |
|---|---|---|
| Project context | Overview, Decisions, References, Active work, Glossary | Project guide (guide, read_first, isGuide), Project overview (note, core_reference), Decision log (note, supporting_context), Active work (note, supporting_context), Glossary (note, core_reference) |

#### Note starter templates

Applied when creating a note. Pre-populates the note's markdown content and sets `read_hint`.

| Template | Kind | read_hint | Use case |
|---|---|---|---|
| Prompt template | note | `core_reference` | Structured prompt definition with purpose, inputs, outputs, usage notes |
| Agent template | note | `read_first` | Agent definition with role, objective, rules, tools, failure modes |
| System template | note | `read_first` | System definition with constraints, invariants, retrieval hints, update policy |
| Guide note | guide | `read_first` | Orients retrieval for a box — read first by AI agents |

### Template definitions

```ts
src/lib/templates/index.ts
```

Templates are plain TypeScript objects — no database table, no dynamic loading.
To add a template: add an entry to `BOX_TEMPLATES` or `NOTE_TEMPLATES` with a stable
`id` and document its intended use.

### Template application flow

**Box template:**
1. User selects a template in `CreateBoxDialog` (optional; blank box is still default)
2. `createBoxAction` creates the box
3. `applyBoxTemplateAction` is called with the new box id + template id
4. For each folder in the template: `createFolder` service call
5. For each note in the template: `createNote` service call with `markdownContent`
6. If a guide note is designated: `assignGuideNote` service call
7. All calls go through normal ownership checks and create audit events

**Note template:**
1. User selects a starter template in `CreateNoteDialog` (optional; blank is default)
2. Selecting a template auto-fills the title field if empty
3. `createNoteAction` is called with the template's `markdownContent` as `markdownContent`
4. User lands on the note page with pre-populated content ready to edit

### Service layer

Template orchestration is extracted into `src/server/services/template_service.ts`.
The action layer is a thin wrapper that adds cache revalidation and error shaping.

```ts
src/server/services/template_service.ts

applyBoxTemplate(supabase, userId, workspaceId, boxId, templateId)
// Creates folders → notes (with readHint) → assigns guide → fires box.template_applied audit
```

### Server actions

```ts
src/app/app/boxes/actions.ts

applyBoxTemplateAction(boxId, templateId)
// Delegates to applyBoxTemplate(); revalidates paths

createNoteAction(boxId, title, folderId, kind, markdownContent, templateId?)
// Creates note; fires note.template_applied audit when templateId is provided
```

### Design decisions

- **No template database table**: Templates are code. They ship with the app, are versioned
  with the codebase, and don't require migrations to add or modify.
- **Deterministic application**: Template application is a sequence of normal service calls.
  There is no special "template mode" — the result looks identical to a user creating the
  same content manually.
- **Template selection is optional**: The default remains a blank box or blank note.
  Templates are a shortcut, not a requirement.
- **Content is editable immediately**: Template-populated notes are regular notes.
  The user owns them and can edit or delete them freely.

---

## Empty states

Improved empty states across the app. All follow the same composition:

1. Short title (noun phrase, not "error" language)
2. One-sentence explanation that teaches the product model
3. Primary action where appropriate

| Surface | Improvement |
|---|---|
| Home (no boxes) | Replaced generic empty state with `OnboardingCallout` that teaches the mental model |
| Workspace (no boxes) | Added description and `CreateBoxDialog` trigger inside the empty placeholder |
| Box tree (empty) | Improved copy to mention "New folder" and "New note" actions |
| Guide note (none assigned) | Added explanatory text teaching what a guide note does |
| Linked notes (none) | Improved copy to mention context bundle inclusion |
| Proposals (none) | Existing panel empty state retained (already adequate) |

---

## Follow-on work (not in V1)

- Dismissible onboarding checklist (track: has_created_note, has_assigned_guide, etc.)
- Template preview before application
- User-defined templates stored in database
- Box template application status feedback (show folder/note count created)
