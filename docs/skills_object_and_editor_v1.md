# Skills — object model and editor (v1)

This document describes how **Skills** work in Context Store: their structure,
their multi-file package model, how children are stored, how the editor page
is organized, and how canonical source, child files, and exports are kept
distinct.

---

## Definition

A **Skill** is a lighter, reusable module. It represents a single coherent
capability you want to reuse across one or more boxes, such as a prompt
template, a small tool, a utility, or a reusable pattern.

Two key properties:

1. A Skill has **exactly one canonical editable source file**. This is the
   single authoritative file you edit and version.
2. A Skill can also have **many supporting child files** and **nested child
   folders**. Supporting files live alongside the canonical source and
   provide examples, fixtures, docs, data, or additional formats the skill
   depends on.

The canonical source is not a single file total — it is one canonical file
plus any number of supporting structural children.

---

## Scoping

A Skill is either:

- **Workspace reusable** (`is_reusable = true`, `box_id = null`) — available
  across the entire workspace. It can be attached by reference into any
  number of boxes without being copied.
- **Box local** (`is_reusable = false`, `box_id = <box>`) — private to a
  single box.

Skills can be moved between folders inside a box, or placed at box root.
Reusable Skills can also own child folders and files at the workspace level
(without any box context).

---

## Storage model

| Concept | Where it lives |
| --- | --- |
| Skill record | `skills` table: `name`, `description`, `source_content`, `canonical_format`, `is_reusable`, `box_id`, `folder_id`, `status`, `current_version_id`, `tags`, etc. |
| Canonical source content | `skills.source_content` (the one canonical editable file) |
| Canonical source versions | `object_versions` with `object_type = 'skill'` (immutable snapshots) |
| Child file records | `files` table with `parent_skill_id = <skill_id>` plus an `object_links` row with `relationship_type = 'parent_of'` |
| Child folder records | `folders` table with `parent_skill_id = <skill_id>` plus an `object_links` row with `relationship_type = 'parent_of'` |
| Exports | Generated on demand via the export service; never stored as new first-class objects |

Both the direct FK columns (`parent_skill_id`) and the
`object_links` rows are maintained. The FK gives fast, direct lookups; the
`object_links` row preserves the heterogeneous semantic model that the rest
of the system relies on.

See migration `supabase/migrations/20260412000001_skill_agent_child_containment.sql`.

---

## Server actions

All child creation routes through server actions in `src/app/app/skills/actions.ts`.

### `createSkillChildFolderAction(skillId, name)`

Creates a real `folders` record. Works for both box-local and reusable
Skills.

For a box-local Skill, the folder is created inside the Skill&rsquo;s box
(`box_id = skill.box_id`) and nested under the Skill&rsquo;s parent folder
if any. For a reusable workspace-level Skill, the folder is created as
workspace-level (`box_id = null`, `workspace_id = <workspace>`).

In both cases the folder&rsquo;s `parent_skill_id` FK is set, and an
`object_links` row is created:
`skill --parent_of--> folder`.

The action revalidates the Skill page, and the parent box page if any.

### `createSkillChildFileAction(skillId, { filename, canonicalFormat, initialContent? })`

Creates a real `files` record. Works for both box-local and reusable
Skills.

The file inherits the Skill&rsquo;s scope: box-local if the Skill has a box,
workspace-level otherwise. The caller picks the canonical format from
`SKILL_AGENT_FORMATS` (markdown, json, yaml, typescript, python, javascript,
shell, xml, plain_text). The file&rsquo;s `parent_skill_id` FK is set, and
an `object_links` row is created:
`skill --parent_of--> file`.

### Where renames, trash, and lifecycle live

Renames and lifecycle actions on child files and folders use the existing
`renameFileAction`, `renameFolderAction`, `trashFileAction`, and folder
lifecycle actions. Child objects inherit the full trust, versioning, and
audit model of the base object type — no new trust logic for Skill
children.

---

## Page layout

`src/app/app/skills/[skill_id]/page.tsx` is organized as a tabbed workspace,
not a single scroll page:

| Tab | What lives there |
| --- | --- |
| **Overview** | Trust header, machine provenance, metadata (format, status, scope, tags, created), lifecycle controls |
| **Source** | The canonical editable source file, rendered in a real source editor. Explanatory text makes clear this is the one canonical source. |
| **Files** | `SkillChildrenPanel`: list of child folders and child files with create buttons. This is the multi-file package surface. Clicking a child navigates to its own editor; navigation preserves Skill context. |
| **History** | Immutable version timeline for the canonical source with one-click rollback. |

The Export menu is always visible in the page header for download of
portable zip packages.

---

## Canonical source vs. child files vs. exports

These three concepts are kept **structurally distinct** at every layer.

| | Canonical source | Child files / folders | Exports |
| --- | --- | --- | --- |
| Where it lives | `skills.source_content` | `files` / `folders` tables with `parent_skill_id` | Ephemeral: built on demand, delivered via signed URL |
| Editable? | Yes (one file only) | Yes (each child editable in its own page) | No — read-only artifacts |
| Versioned? | Yes, via `object_versions` for skill | Yes, via `object_versions` for each file | No |
| Visible surface | Source tab | Files tab (`SkillChildrenPanel`) | Export menu in page header |
| Count | Exactly one | Many possible | Many possible (one per export call) |

We never blur these three concepts. A child file is **not** a second
canonical source. A canonical source is **not** stored in the `files`
table. An export is **not** a persistent object — it is a generated
package.

---

## Reusable attachment semantics

When a reusable Skill is attached into a box via `box_object_attachments`,
only the attachment reference is stored. The Skill&rsquo;s child files and
folders remain owned by the Skill, not by the box. Detaching a reusable
Skill from a box removes the reference only — the Skill and its children
are not affected.

---

## Children panel component

`src/components/product/skill_children_panel.tsx` implements the Files tab
surface. Key properties:

- Always renders the New Folder and New File buttons.
- Dialogs are rendered **outside** any conditional return so they work
  in both empty and populated states.
- On success, calls `router.refresh()` so the new child appears
  immediately.
- Accepts `canCreateFolders` prop (default `true`) so the folder create
  path is available for all Skill scopes.
- Lists folders first, then files, with icons from `lucide-react`.
- Empty state includes real, working action buttons — not a placeholder.

---

## Invariants

1. Every Skill has exactly one canonical source file.
2. A Skill&rsquo;s child count is unbounded; a Skill can have zero or
   many child files and folders.
3. Child files use any format from `SKILL_AGENT_FORMATS`. The canonical
   source format is independent of child file formats.
4. Rollback on the Skill version history restores only the canonical
   source, never the children. Children have their own version history.
5. Trashing the Skill does not destroy children; it marks the Skill
   trashed and cascades to attachments. Children retain their own
   lifecycle state.
6. Attached reusable Skills expose their children inside the target box
   tree by reference; edits still flow through the Skill&rsquo;s canonical
   editor.

---

## Rules for future prompts

1. Do not convert child files into a second canonical source.
2. Do not store export output as a new object type.
3. Do not skip the `parent_skill_id` FK when creating children.
4. Do not require a box_id for child creation on reusable Skills —
   folder creation must work when `box_id` is null.
5. Do not break the tab separation (Overview / Source / Files / History).
6. Preserve immutable versioning, audit append-only, and the reusable
   attachment-by-reference model.

## Branch-aware writes (v1.1)

Skills are now branch-aware on their canonical editable source.
When a draft branch is active, `saveSkillAction` routes through
`updateSkillContentOnBranch`, which writes a new immutable
`object_versions` row and upserts `branch_heads`. The canonical
`skills` row is never touched until promote.

Branch reads: `getSkillForWorkspace(.., branchId)` patches
`source_content`, `content_bytes`, and `current_version_id` from
the branch head when one exists. Non-versioned fields
(name, description, tags, summary, status, is_reusable,
canonical_format) remain on main.

**Child files and child folders of a skill are NOT branch-aware via
the skill itself.** They are individual File / Folder objects; a
child file is branch-edited through its own `/app/files/<id>` page
which wires the same pattern. See
[`docs/branch_aware_writes_v1.md`](branch_aware_writes_v1.md).
