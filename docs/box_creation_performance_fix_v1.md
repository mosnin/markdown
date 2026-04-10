# Box Creation Performance Fix (v1)

## Summary

Box creation was materially slow when a template was selected. The entire template
application ran synchronously before `router.push()` was called, meaning the user
waited for every folder insert, note insert, versioning RPC call, and audit event
before seeing any UI. The fix moves template application off the critical path
entirely without weakening any ownership, versioning, or audit behavior.

---

## What the bottleneck was

The `CreateBoxDialog.handleSubmit` function had this sequential chain:

```
1. createBoxAction(name, description)         ← critical: auth + limit check + DB insert + audit
2. applyBoxTemplateAction(boxId, templateId)  ← BLOCKING: folders + notes + versioning + audit
3. router.push('/app/boxes/${boxId}')         ← navigation only starts after both complete
```

Step 2 dominated the wait time. For the "Project context" template (2 folders, 3 notes with
full versioning, guide assignment, audit):

- Each `createFolder` call: ~1 auth + workspace lookup, 1 path_cache compute, 1 insert, 1 audit
- Each `createNote` call: 1 auth + workspace lookup, 1 `create_note_with_initial_version` RPC, 1 audit
- Total template application: **~800–1500 ms sequential DB work**

The user saw "Creating…" for the entire duration before any navigation happened.

Template application also called `getRequestContext()` again (a second auth verification +
workspace bootstrap) since it ran as a separate server action. Two full auth round trips
on the critical path.

### Secondary bottleneck: missing workspaces revalidation

`createBoxAction` called `revalidatePath('/app')` but not `revalidatePath('/app/workspaces')`.
The workspaces list page was never invalidated after box creation — it showed a stale box
count until the user did a hard refresh.

---

## How the critical path was shortened

### Before (with template)

```
submit → createBoxAction (300–600ms)
       → applyBoxTemplateAction (800–1500ms)  ← blocks navigation
       → router.push
       → layout + page load (300–500ms)
─────────────────────────────────────────────
Total perceived wait: ~1400–2600ms
```

### After (with template)

```
submit → createBoxAction (300–600ms)
       → router.push with ?setup=<templateId>
       → layout + page load (300–500ms)       ← user is in the box now
          └── BoxTemplateSetup fires in background (800–1500ms, non-blocking)
              └── router.replace('/app/boxes/${boxId}') when done
─────────────────────────────────────────────
Perceived wait to first screen: ~600–1100ms
```

### Without template (unchanged, now documented)

```
submit → createBoxAction (300–600ms)
       → router.push
       → layout + page load (300–500ms)
─────────────────────────────────────────────
Total: ~600–1100ms (unchanged; was already fast)
```

---

## How it works

### `CreateBoxDialog` (modified)

`applyBoxTemplateAction` is completely removed from `handleSubmit`. After
`createBoxAction` succeeds, the dialog navigates immediately:

```ts
router.push(
  selectedTemplate
    ? `/app/boxes/${boxId}?setup=${encodeURIComponent(selectedTemplate)}`
    : `/app/boxes/${boxId}`
);
```

### `BoxTemplateSetup` (new — `src/components/product/box_template_setup.tsx`)

A small client component rendered by the box page when `?setup=<id>` is in the
URL and the box is empty. It runs `applyBoxTemplateAction` in a `useEffect` and
shows a subtle "Applying template…" spinner while it runs. On success, it calls
`router.replace('/app/boxes/${boxId}')` to navigate to the clean URL and trigger
a fresh server render that shows the template content.

### Guard against re-application

The box page renders `BoxTemplateSetup` only when:

```tsx
typeof resolvedSearch.setup === "string" &&
resolvedSearch.setup.length > 0 &&
notes.length === 0 &&       // server-side empty check
folders.length === 0        // server-side empty check
```

A box that already has content (from a previous visit, a bookmark, or a shared
URL) will never trigger `BoxTemplateSetup`. Ownership and versioning remain fully
enforced inside `applyBoxTemplateAction` — nothing is bypassed.

### `createBoxAction` (fixed revalidatePath)

Added `revalidatePath('/app/workspaces')` so the workspaces list page shows the
correct box count immediately after creation. The existing `revalidatePath('/app')`
is kept to invalidate the home dashboard and the `/app` layout cache tag
(`_N_T_/app/layout`), which forces `listBoxesByWorkspace()` to re-run and show
the new box in the sidebar.

---

## What was preserved

| Constraint | Status |
|---|---|
| Ownership checks in createBoxAction | Unchanged — auth + workspace + limit enforcement |
| Box audit event (auditBoxCreated) | Unchanged — awaited, append-only |
| Template audit event (auditBoxTemplateApplied) | Unchanged — fires inside applyBoxTemplateAction |
| Versioning (create_note_with_initial_version RPC) | Unchanged — each template note gets a version |
| note_versions immutability | Unchanged |
| audit_events append-only | Unchanged |
| Stable IDs | Unchanged — boxId is canonical identity throughout |
| Trust / ownership | Unchanged — getRequestContext() called inside each server action |

---

## Sidebar behavior after creation

When the user lands in the new box, the `/app` layout (which runs
`listBoxesByWorkspace()`) will re-execute on this navigation because
`revalidatePath('/app')` invalidated the `_N_T_/app/layout` cache tag.
The sidebar will show the new box as the user arrives.

The sidebar tree auto-expands the active box via `useEffect` in `TreeSidebar`,
keyed on `currentBoxId`. The new box expands and shows "No content yet" while
the template setup runs. After `router.replace` triggers a fresh server render,
the tree re-fetches and shows the created folders and notes.

---

## Deferred work (not in this fix)

1. **`checkBoxLimit` parallelism**: currently does a sequential subscription
   query → box count query. Could be parallelized (run both, discard count if
   pro) to save ~50–100ms. Not done here; the change is in a shared service
   function and requires careful testing.

2. **Slug uniqueness as a DB function**: `getBoxBySlug()` adds one DB round trip
   for uniqueness checking before the insert. Could be replaced by an atomic
   `INSERT ... ON CONFLICT` pattern or a DB function. Deferred; requires a
   migration and is "adding backend scope".

3. **`revalidatePath` scope audit**: other create/update/delete actions in the
   codebase may have similar missing revalidations (e.g. folder create not
   revalidating workspaces). Worth a systematic pass in a future cleanup prompt.
