# Workspace selector, search, and multi-user membership — v1

This memo covers three tightly-coupled changes: fixing the broken
workspace selector, rebuilding the search surface as a real
workspace-wide finder, and introducing multi-user workspace access.

## 1. Workspace selector

### What was broken

Clicking the selector at the top of the sidebar threw. Two
`DropdownMenuItem` entries used `render={<Link href="..." />}` — a
Base UI composition pattern that clones the provided element as the
item's root. Passing a `next/link` `<Link>` component through that
clone path collides with Link's own internal element handling; the
menu opened, attempted to render the cloned Link as the item, and
threw during commit.

The two entries in question were "Manage boxes" and "Workspace
settings".

### The fix

`workspace_switcher.tsx` now uses the same `onClick` + `router.push`
pattern the rest of the codebase uses (`user_menu.tsx`,
`tree_sidebar.tsx`). The navigation is wrapped in a `setTimeout(…, 0)`
so Base UI's Menu close animation + focus return completes before the
router push — identical to the existing switcher workaround for
opening the Create dialog.

### How the selector behaves now

- Lists every workspace the signed-in user is a **member** of, not
  only owned ones. `listAccessibleWorkspaces` in
  `workspace_membership_repository.ts` joins
  `workspace_memberships` to `workspaces`.
- Shows a check on the active workspace.
- Selecting a different workspace calls `setActiveWorkspaceAction`,
  which now accepts any workspace the user has membership in (not
  only owned).
- "New workspace" opens the existing Dialog, creates the workspace,
  and writes the admin membership row for the creator.
- "Manage workspaces" routes to `/app/workspaces` (existing page).
- "Workspace settings" routes to `/app/settings` (existing page).

### Workspace model

Before this change, **the repo already supported multiple workspaces
per user** (confirmed via `listWorkspacesByOwner` and the
`workspaces.owner_id` column). The selector was broken but the
underlying model was multi-workspace, not single-workspace. This
change extends that model with memberships so workspaces can also be
shared across users.

## 2. Workspaces route

The route at `/app/workspaces` already existed and worked. No
structural changes were needed — it continues to list owned
workspaces plus boxes in the active workspace, and now correctly
reflects multi-workspace membership via the repository switch above.

## 3. Search

### What was broken

Search was scoped to notes only. The page UI was a minimal utility
panel, disconnected from the rest of the product surface. The service
called `search_notes` RPC with a box id, so cross-box / cross-type
finding was impossible.

### What we built

New service: `src/server/services/workspace_search_service.ts`
(`searchWorkspace`). Covers **notes, files, skills, agents, folders,
and boxes** in parallel. Matches on display name first (ranked by
exact / prefix / substring) and falls back to body / description
substring matches. Results are unified into `WorkspaceSearchHit` so
the UI renders one row shape regardless of type.

Ranking is deterministic: title exact > title prefix > title
substring > body substring, with `updated_at DESC` as the final
tiebreaker. This preserves the "deterministic retrieval" principle
without requiring FTS for every type.

New server action: `src/app/app/search/actions.ts`
(`searchWorkspaceAction`). Wraps the service with auth and workspace
context. Workspace scoping is enforced by RLS (membership-based), so
viewers / members / admins each only see hits from workspaces they
belong to.

New page: `src/app/app/search/page.tsx` + a rebuilt
`search_client.tsx`. The page uses the product's `PageHeader`, the
input uses the same `Input` primitive as the rest of the app, and the
surface matches the dashboard card / badge language. Features:

- 180ms debounced server-action calls
- `⌘/Ctrl+K` focuses and selects the input
- `↑` / `↓` navigate highlighted results, `Enter` opens the highlighted
  hit (via `window.location.assign` to respect middleware redirects)
- Grouped results by object type with counts
- Explicit empty prompt, loading state, no-results state, and error
  state — none of these were useful before
- Each hit renders object type, title, box/breadcrumb, snippet (up to
  240 chars), status badge (if not `active`), and type badge
- Each hit links to the canonical object route (`/app/notes/{id}` etc.)

### Scope and limitations (real, not polite)

- **Substring search, not stemming.** Files / skills / agents / folders /
  boxes use ILIKE. Notes also use ILIKE here (the existing
  `search_notes` FTS RPC is still reachable via the box-scoped
  action). A follow-up can promote notes to FTS in the unified
  service without changing the call surface.
- **Trashed items are filtered out** at the query level. Archived
  items still show with a badge.
- **Per-type soft cap is 12 hits** before merge. Relevance plus
  rapid search is more useful than completeness here.

## 4. Multi-user workspace membership

### Schema

Migration `20260412000003_workspace_memberships.sql`:

- New table `workspace_memberships(workspace_id, user_id, role,
  invited_by, invited_at, accepted_at, …)` with unique
  `(workspace_id, user_id)`.
- Backfill: every existing owner gets an `admin` membership.
- Redefined `owns_workspace(wid)` to any-member semantics so legacy
  RLS accepts members transparently.
- New helpers: `workspace_role(wid)`, `can_write_workspace(wid)`,
  `can_admin_workspace(wid)`.
- RLS on `workspace_memberships`: self-read always; admin
  read/write; all DML restricted to admins.

### Application seams

- `WorkspaceContext.role` is now carried by every request context.
  `src/server/domain/types/workspace.ts` adds the `WorkspaceRole`
  type (`owner | admin | member | viewer`).
- `src/server/auth/require_role.ts` adds `canWrite`, `canAdmin`,
  `requireWriteRole`, `requireWriteRoleResult`, `requireAdminRole`,
  `requireAdminRoleResult`. Server actions use these to gate
  mutations and surface friendly `ActionResult` errors.
- `src/app/app/boxes/actions.ts`'s `requireContext()` defaults to
  `requireWrite: true`. Tree-fetch / search / attachable-list actions
  explicitly opt out with `requireContext({ requireWrite: false })`.
- `src/server/repositories/workspace_membership_repository.ts` exposes
  `listAccessibleWorkspaces`, `getWorkspaceRole`,
  `listWorkspaceMembers`, `upsertMembership`, `removeMembership`.
- `getOrCreateDefaultWorkspace` now lists accessible workspaces (not
  just owned). The bootstrap path for a brand-new user still creates a
  workspace and inserts the owner's admin membership.

### Enforcement map

| Surface                        | Check                                                                 |
|--------------------------------|------------------------------------------------------------------------|
| SELECT on workspace-scoped rows| RLS via `owns_workspace(wid)` (any role)                              |
| Content writes (notes, files, skills, agents, folders, boxes, attachments) | `requireContext()` writes reject viewer role via `ctx.workspace.role` check |
| Member management              | `requireAdminRoleResult` in `member_actions.ts`                       |
| Settings panels                | The Members section conditionally renders based on `canAdmin(role)`   |
| Workspace switch               | `setActiveWorkspaceAction` accepts any accessible workspace           |

### Invitation flow

Implemented as direct-add by email through the admin API (no pending
invites, no email sends). See `docs/auth_and_permissions.md` for the
full flow. UI lives at `/app/settings` under the Members card.

### Audit

`workspace.member.invited / .role_changed / .removed` — append-only,
metadata includes the target user id and role. Consistent with the
existing audit taxonomy.

## Limitations

- **Email invitations with a sign-up link** are not in V1. Admins can
  only add users that already have an account.
- **Ownership transfer** is not exposed. Owners remain canonical for a
  workspace; an admin cannot become the owner.
- **Write gating is application-side.** The RLS layer still keys on
  `owns_workspace()` (now "any member"), so a direct Supabase REST
  write from a viewer's token would bypass the gate. In practice no
  first-party surface exposes that path — the app proxies every write
  through server actions — but this is the deliberate V1 trade-off
  documented in `docs/auth_and_permissions.md`.
- **Per-object permissions** (box-level sharing, per-folder viewer
  grants, etc.) are out of scope. Role applies uniformly across the
  whole workspace.
- **Search is ILIKE-backed** for every type except notes, which still
  have an FTS vector that a follow-up can route through the unified
  service.
