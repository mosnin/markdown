# Branch RLS and data-integrity hardening — v1

The branch overlay system (migrations `20260412000008` +
`20260412000009` and the later overrides/pending-ops tables) gave
every branch-aware table an explicit `branch_id` column, but the Row
Level Security policies on those tables were never updated to look at
it. This doc summarises the audit finding and the fix that landed in
`supabase/migrations/20260413000003_branch_rls_hardening.sql`.

## The gap

Workspaces can have multiple members (`workspace_memberships`), and
the RLS helpers `owns_workspace(wid)` / `can_write_workspace(wid)`
return true for any member in any role or member-or-admin
respectively. The previous policies on branch-bearing tables — notes,
folders, boxes, files, object_links — only consulted those helpers.
That means once two members shared a workspace, member A's
authenticated client could SELECT, UPDATE or DELETE member B's draft
rows (rows with `branch_id = <B's branch>`) despite the branch
belonging to member B. Reads leaked, writes corrupted, discard didn't
protect.

The `branch_id` column on each row identifies a `draft_branches`
row, which in turn carries a `workspace_id`. We reuse the same
workspace-membership helper against that workspace to decide whether
the calling user has any business touching the row.

## The fix

### 1. Branch-access clause on every affected policy

Each `SELECT / INSERT / UPDATE / DELETE` policy on `notes`, `folders`,
`boxes`, `files`, `object_links` is rebuilt to `AND` the original
workspace clause with:

```sql
branch_id IS NULL
OR EXISTS (
  SELECT 1 FROM public.draft_branches db
  WHERE db.id = branch_id
    AND public.<helper>(db.workspace_id)
)
```

`owns_workspace` is used on SELECT policies (matching the existing
read-side shape); `can_write_workspace` on INSERT / UPDATE / DELETE
(matching the existing write-side shape from
`20260412000005_rls_write_role_gate`).

`branch_id IS NULL` short-circuits the check for main rows — nothing
about existing main-row access changes. Only branch rows gain the
extra gate, and the gate passes whenever the branch's workspace is
visible to the caller, which today means the same workspace the row
already lives in. The policy is therefore conservative: it only
rejects when `branch_id` points at a branch belonging to a workspace
the caller doesn't belong to — which shouldn't happen under normal
operation but is a defence against bugs where a row's `branch_id` is
ever written with a cross-workspace value.

#### Why skills and agents are not covered

The audit originally mentioned `skills` and `agents` too. Those
tables do **not** carry a `branch_id` column — their branch-aware
state lives in the `branch_package_metadata` overlay table (see
`20260412000007_branch_package_metadata.sql` and
`docs/package_branch_state_for_skills_and_agents_v1.md`). There is no
column to gate on, so the branch-access clause is not applicable.
The overlay table itself is already gated through
`draft_branches.workspace_id` + `can_write_workspace`.

### 2. `draft_branches` write policies tightened

`20260412000004_rollback_foundations.sql` originally created the
table with a single `FOR ALL` policy gated on `owns_workspace`.
Overlay tables that depend on it — `branch_pending_ops`,
`folder_branch_overrides`, `branch_placement_overrides` — already use
`can_write_workspace` for writes, which makes the laxer gate on the
parent row inconsistent.

We drop the combined `FOR ALL` policy and replace it with three
explicit ones (`INSERT`, `UPDATE`, `DELETE`) gated on
`can_write_workspace`. `SELECT` stays on `owns_workspace` because a
viewer should still see the list of branches to understand what the
workspace contains.

### 3. Zero-UUID sentinel CHECK

The partial unique indexes rebuilt in
`20260412000008_branch_scoped_structural_rows.sql` and
`20260412000009_branch_scoped_content_rows.sql` use
`COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)`
so a main row and a branch row can share the same logical key without
colliding in the index. This only holds as a sentinel as long as no
real `draft_branches.id` is ever equal to the nil UUID.

The FK to `draft_branches(id)` + `gen_random_uuid()` defaults make a
real collision astronomically unlikely, but we add an explicit
`CHECK (branch_id IS NULL OR branch_id <> '00000000-...'::uuid)` on
every table with a `branch_id` column so:

- A backfill or seed that hard-codes the nil UUID fails loudly rather
  than silently merging a branch row into the main partition of the
  unique index.
- The sentinel contract is visible in the schema instead of hidden in
  a partial-index expression.

Tables covered: `notes`, `folders`, `boxes`, `files`, `object_links`.
`skills` / `agents` are excluded for the same reason as above — no
`branch_id` column.

## Pending-ops object-type alignment

The audit also flagged that the SQL CHECK on
`branch_pending_ops.object_type` includes `'box_object_attachment'`
but the TS union might not. We verified the current TS source
(`src/server/services/pending_op_service.ts`) and existing test
(`src/tests/unit/pending_op_service.test.ts`): the TS union, the
applier's `tableMap`, and a dedicated `detach on box_object_attachment`
test are already in place at baseline. No TS change is needed;
the SQL CHECK and TS union are aligned.

## Related docs

- [branch_local_structural_creation_v1.md](branch_local_structural_creation_v1.md)
- [branch_aware_writes_v1.md](branch_aware_writes_v1.md)
- [package_branch_state_for_skills_and_agents_v1.md](package_branch_state_for_skills_and_agents_v1.md)
- [branch_local_sort_order_and_reorder_isolation_v1.md](branch_local_sort_order_and_reorder_isolation_v1.md)
