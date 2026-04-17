# Context Store v2 — overview

Starting point for a contributor picking up Context Store after the v2
sprint. Maps what landed, links the focused docs.

## TL;DR

v2 turns Context Store from a single-writer note system into a
branch-aware, multi-actor platform. Every mutation is isolated to a
draft branch until explicitly promoted, AI clients reach the system
through OAuth 2.1 instead of paste-in tokens, and promote + restore are
atomic end-to-end so failed runs cannot half-land.

## Branch system

Draft branches became the primary way structural and content edits are
staged. Every content-bearing table (notes, files, skills, agents,
folders, boxes, `note_links`, `object_links`, `box_object_attachments`,
folder overrides, placement overrides) carries a real `branch_id`; the
search, folder, archived / trashed, and context-bundle read paths all
accept a branch and overlay correctly.

- [branch_aware_writes_v1.md](branch_aware_writes_v1.md) — write path,
  active-branch cookie, per-object contracts.
- [branch_local_structural_creation_v1.md](branch_local_structural_creation_v1.md) —
  branch-local creation / placement / lifecycle / link / attachment
  closures (commits `9a2c901`, `012bd16`, `45ec820`, `cc04ab8`,
  `c722e09`, `4e25808`, `c60da9d`).
- [branch_rls_hardening_v1.md](branch_rls_hardening_v1.md) — RLS clauses
  that cover `branch_id`, zero-UUID CHECKs, draft-branches write gate
  (commit `fb300e9`).
- [package_branch_state_for_skills_and_agents_v1.md](package_branch_state_for_skills_and_agents_v1.md) —
  Skill / Agent package drafting.
- [rollback_architecture_v1.md](rollback_architecture_v1.md) +
  [rollback_schema_and_restore_engine_v1.md](rollback_schema_and_restore_engine_v1.md) —
  change-set model, promote as a single
  `origin: 'branch_promotion'` change set, undo-promote via
  `restoreFromChangeSet`.

## MCP + OAuth

The MCP surface moved off pasted `csk_v1_` tokens and onto OAuth 2.1 +
PKCE over HTTP, with a real authorize / consent page, self-service
client management, and a Connected apps grant-revoke view.

- [mcp_v1.md](mcp_v1.md) — integrator-facing MCP surface, tool list
  (now including `create_branch`, `write_to_branch`,
  `get_branch_diff`, `list_branches`), and the OAuth-primary flow.
- [mcp_auth_architecture_foundation_v1.md](mcp_auth_architecture_foundation_v1.md) —
  foundation commit `2eefda4`: unified auth resolver, scope model,
  deprecation of `csk_v1_`, audit attribution.
- [mcp_oauth_product_surface_and_token_lifecycle_v1.md](mcp_oauth_product_surface_and_token_lifecycle_v1.md) —
  productization commits `479892e`, `0f49018`, `9989444`: every
  `/api/v1/**` rewired through the unified resolver, rate-limit table,
  full audit event table, authorize page UX, client-management UI,
  Connected apps, branch-write rejection.

## Safety and reliability

- **RLS hardening** — branch-access clauses on every branch-bearing
  table, draft-branches write tightening, zero-UUID CHECK constraints
  (`fb300e9`). See [branch_rls_hardening_v1.md](branch_rls_hardening_v1.md).
- **Refresh-token CAS** — refresh tokens rotate through compare-and-swap
  so parallel refresh attempts can never split a session (`51a1009`).
- **Atomic promote** — `promoteBranch` opens one change set, advances
  every head + applies metadata overlays, and aborts the change set if
  any step fails. A `promoting` status flag blocks concurrent promotes;
  discard cleans the overlay rows (`37b6a25`).
- **Rate limits + request-size guard** — `/api/oauth/*`, `/api/mcp`, and
  `/api/v1/**` all share a null-safe, bucket-based limiter; request
  bodies over the configured cap return `413` instead of failing
  downstream (`51a1009`, `479892e`).
- **Audit attribution** — every OAuth-backed write carries
  `actor_type = 'connection'`, the client id, the access-token id, and
  the change set id; see the audit event table in
  [mcp_oauth_product_surface_and_token_lifecycle_v1.md](mcp_oauth_product_surface_and_token_lifecycle_v1.md).
- **OAuth discovery base URL** — canonical base URL resolution is
  unified across `/.well-known/oauth-authorization-server` and
  `/.well-known/mcp-server` so proxied and direct hosts agree
  (`88b9500`).
- **Hydration-safe dates + `revalidatePath`** — residual hydration
  mismatches in grids, footer / legal year, and proposal pages fixed
  (`486d108`, `aae3612`).
- **Mobile sidebar portal collision** — nested Sheet portals removed
  from `MobileSidebar` (`b8d9960`).
- **Workspace bootstrap duplicate-key** — bootstrap crash on `/sign_in`
  and `/app` fixed (`0f32538`).

## User-facing features new in v2

- **AI-authored branches** — `create_branch`, `write_to_branch`,
  `get_branch_diff`, `list_branches` MCP tools with `branch:write`
  scope; drafts carry `actor_type = 'connection'` authorship through
  the banner and diff views. See [mcp_v1.md](mcp_v1.md).
- **Conflict resolution + rebase** — branch-detail client detects when
  main has moved ahead of a branch head, shows a 3-way base / main /
  branch panel, and offers `keep_branch` / `keep_main` /
  `rebase_branch_on_main` strategies. See the conflict + rebase section
  of [branch_local_structural_creation_v1.md](branch_local_structural_creation_v1.md).
- **Undo promote** — user-exposed rollback of a promotion change set
  via the existing restore engine; see the promote-undo section of
  [rollback_schema_and_restore_engine_v1.md](rollback_schema_and_restore_engine_v1.md).
- **Connector setup wizard** — multi-step `/app/settings/oauth_clients/new`
  client-registration UI with inline validation. See
  [mcp_v1.md](mcp_v1.md).
- **Context bundle branch awareness** — `assembleContextBundle` accepts
  `include_user_branches` and overlays the caller's pending edits on
  target + linked + guide notes; exposed on `/api/v1/context_bundles`,
  `/api/mcp` bundle tool, and the MCP canonical client. See
  [context_bundle_v1.md](context_bundle_v1.md).
- **Review workflow** — `branch_reviews` + `branch_comments` tables
  gate `promoteBranch` on approval; per-diff-row comment threads and
  an in-page review panel live in the branch detail UI. See the review
  section of [branch_local_structural_creation_v1.md](branch_local_structural_creation_v1.md).
- **Cherry-pick** — deferred; not landed in this sprint.

## Architecture state

- Promote is atomic. One change set, abort-on-failure, concurrent
  guard, discard cleans up overlay rows.
- Overlays are isolated. Every branch-bearing table has a `branch_id`,
  RLS enforces workspace + branch membership, writes go through
  branch-aware services.
- Change-set rollback is user-exposed. The restore engine is no longer
  an internal primitive — promote-undo and audit-log "restore this"
  both call `restoreFromChangeSet`.
- Discovery URLs are unified. OAuth + MCP metadata agree on the
  canonical base URL across proxied and direct hosts.
- Authorship is end-to-end. AI-authored branches, OAuth-backed writes,
  and human edits all carry consistent `actor_type` + actor ids
  through audit + banners + diff views.

## Known limitations and deferred

- `csk_v1_` legacy tokens still work for first-party local dev but
  there is no migration UI for existing `csk_v1_` integrators — they
  must re-register as OAuth clients by hand.
- Context-bundle branch overlay performs N+1 reads across linked notes
  when `include_user_branches` is set; fine at current linked-note
  caps, will need a batched branch-head resolver at scale.
- Cherry-pick (Tier 2d) is deferred.
- Workspace-level review policy (require-review-before-promote as a
  workspace setting) is not yet exposed — the gate is per-branch via
  `requestReview`.

## Where to start contributing

1. Read [architecture.md](architecture.md) for the module layout and
   the canonical layering rule (`api → resolvers → services →
   repositories → database`).
2. Read [auth_and_permissions.md](auth_and_permissions.md) for the
   role / scope / permission_mode vocabulary that the MCP + OAuth
   surface inherits.
3. Pick the focused doc above that matches the area you are touching.
4. If you are adding a new write path, it must accept a branch id and
   must open a change set. Both are checked in tests — see
   `src/tests/unit/branch_*` and `src/tests/unit/*change_set*`.
