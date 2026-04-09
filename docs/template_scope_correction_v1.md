# Template Scope Correction V1

This document records the corrections applied to the template and starter flow layer. These changes bring the product in line with the original V1 template contract.

---

## What changed and why

Prior to this correction:
- BOX_TEMPLATES contained three incorrect entries: `research`, `project`, `knowledge`.
- NOTE_TEMPLATES contained three incorrect entries: `guide_note`, `overview_note`, `bundle_prep`.
- Template notes did not set `read_hint` at creation time — the system default was applied instead.
- `applyBoxTemplateAction` contained the full orchestration logic inline.
- No audit event existed for template application at the box level.
- No audit event existed for note creation from a starter template.

After this correction:
- BOX_TEMPLATES contains the single canonical V1 entry: `project_context_template`.
- NOTE_TEMPLATES contains the four canonical V1 entries: `prompt_template`, `agent_template`, `system_template`, `guide_note`.
- Template notes carry a `readHint` field; `applyBoxTemplate` passes it to `createNote`.
- Template orchestration is extracted into `template_service.ts`.
- `applyBoxTemplateAction` delegates to `applyBoxTemplate()` in the service layer.
- `box.template_applied` audit event is fired after template application.
- `note.template_applied` audit event is fired when `createNoteAction` is called with a `templateId`.

---

## 1. Canonical template set

### Box templates

One box template is defined in V1:

| ID | Label | Folders | Notes |
|---|---|---|---|
| `project_context_template` | Project context | Overview, Decisions, References, Active work, Glossary | Project guide (guide, read_first, isGuide), Project overview (note, core_reference), Decision log (note, supporting_context), Active work (note, supporting_context), Glossary (note, core_reference) |

### Note starter templates

Four note starter templates are defined in V1:

| ID | Label | Kind | read_hint | Purpose |
|---|---|---|---|---|
| `prompt_template` | Prompt template | note | `core_reference` | Structured prompt definition with purpose, inputs, outputs, usage notes, revision history |
| `agent_template` | Agent template | note | `read_first` | Agent definition with role, objective, rules, tools, failure modes, escalation, trust |
| `system_template` | System template | note | `read_first` | System definition with constraints, invariants, retrieval hints, update policy, trust, change log |
| `guide_note` | Guide note | guide | `read_first` | Box orientation note read first by AI agents and context bundles |

---

## 2. Template application modes

### Box template application

1. User selects `project_context_template` in `CreateBoxDialog` (optional — blank box remains default).
2. `createBoxAction` creates the box.
3. `applyBoxTemplateAction` is called with the new box id + template id.
4. The action delegates to `applyBoxTemplate()` in `template_service.ts`.
5. For each folder in the template: `createFolder` service call.
6. For each note in the template: `createNote` service call with `markdownContent` and `readHint`.
7. If a note is designated as guide (`isGuide: true`): `assignGuideNote` service call.
8. `box.template_applied` audit event is fired (fire-and-forget).
9. Page cache is revalidated.

### Note starter template application

1. User selects a starter template in `CreateNoteDialog` (optional — blank note remains default).
2. Selecting a template auto-fills the title field if empty.
3. `createNoteAction` is called with the template's `markdownContent`, `kind`, and `templateId`.
4. `createNote` creates the note (fires `note.created` audit event).
5. `note.template_applied` audit event is fired (fire-and-forget).
6. User lands on the note page with pre-populated content ready to edit.

---

## 3. read_hint fidelity

Template notes set `read_hint` at creation time using the template-defined value. This is intentional: the template encodes the intended retrieval role of each note. A guide note should be `read_first`; a glossary should be `core_reference`.

Without explicit `readHint` on the template definition, notes would inherit the system default (`null`), which retrieval surfaces treat as lower priority than explicitly tagged notes.

---

## 4. Service layer

Template orchestration is now in `src/server/services/template_service.ts`. The action layer (`applyBoxTemplateAction`) is a thin wrapper that adds revalidation and error shaping.

This separation keeps the orchestration testable and prevents the action file from accumulating service logic.

### `applyBoxTemplate(supabase, userId, workspaceId, boxId, templateId)`

- Looks up the template from `BOX_TEMPLATES`
- Creates folders in order (tracking key → id for note placement)
- Creates notes with `readHint` from the template definition
- Assigns the guide note if one is designated
- Fires `box.template_applied` audit event

---

## 5. Audit events

| Event | Object | Fired by | Metadata |
|---|---|---|---|
| `box.template_applied` | `box` | `applyBoxTemplate` in template service | `template_id`, `folder_count`, `note_count` |
| `note.template_applied` | `note` | `createNoteAction` when `templateId` is provided | `template_id`, `title`, `box_id` |

---

## 6. What did not change

- Template application still calls normal service functions. No versioning, audit, or ownership checks are bypassed.
- The default experience (blank box, blank note) is unchanged.
- The template lookup helpers (`getBoxTemplate`, `getNoteTemplate`) in `src/lib/templates/index.ts` are unchanged in signature.
- No database table for templates — templates remain plain TypeScript objects.

---

## 7. Files added or modified

| File | Change |
|---|---|
| `src/lib/templates/index.ts` | Replaced incorrect template set with canonical four; added `readHint` field to interfaces |
| `src/server/services/template_service.ts` | New — `applyBoxTemplate()` with `readHint` propagation and audit |
| `src/server/services/audit_service.ts` | Added `auditBoxTemplateApplied()` and `auditNoteCreatedFromTemplate()` |
| `src/app/app/boxes/actions.ts` | `applyBoxTemplateAction` delegates to template service; `createNoteAction` accepts optional `templateId` |
| `docs/onboarding_and_templates_v1.md` | Updated template tables and service layer description |
| `docs/template_scope_correction_v1.md` | This document |
