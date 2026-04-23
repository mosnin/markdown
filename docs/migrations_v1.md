# Database Migrations

All schema changes live in `supabase/migrations/` as numbered SQL files. Migrations are applied in filename order by `supabase db push`. There are currently 91 migrations.

---

## How to run migrations

```bash
# Interactive (prompts "Are you sure? Type 'yes' to continue:"):
./scripts/push_migrations.sh

# Non-interactive (CI):
CI=1 ./scripts/push_migrations.sh

# Dry run (passes --dry-run to supabase db push):
./scripts/push_migrations.sh --dry-run

# Direct:
supabase db push
```

Requires the `supabase` CLI on PATH. See `scripts/README.md` for full script documentation.

---

## Writing a new migration

1. Name the file `YYYYMMDDNNNNNN_description.sql` where `NNNNNN` is a zero-padded 6-digit sequence. Today's date prefix ensures ordering. Example: `20260430000001_add_foo_column.sql`.
2. Place it in `supabase/migrations/`.
3. Write idempotent SQL (`IF NOT EXISTS`, `IF EXISTS`, `OR REPLACE`, etc.) wherever possible.
4. Include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` and `CREATE POLICY` statements for any new table.
5. Test locally with `supabase db reset` (rebuilds from scratch) and `supabase db push` (incremental).
6. Never edit or delete a migration file after it has been pushed to any environment.

---

## Rollback policy

Supabase does not support down-migrations. To revert a change:

1. Write a new corrective migration that reverses the change (e.g., `DROP COLUMN`, re-creating removed indexes, etc.).
2. Push the corrective migration.

This keeps the migration history append-only and auditable.

---

## Migration timeline

### 2026-04-09 — Core schema (v1 baseline)

| File | What it does |
|---|---|
| `20260409000001_core_schema.sql` | Workspaces, boxes, folders, notes, note_versions, files, connections, skills, agents, tags tables. Core schema. |
| `20260409000002_rls_policies.sql` | Initial RLS policies for all v1 tables. |
| `20260409000003_note_rpc_functions.sql` | Postgres RPCs: `create_note_and_version`, `update_note_content`, `get_note_with_version`. |
| `20260409000004_fts_indexes.sql` | `tsvector` full-text search indexes on notes and boxes. |
| `20260409000005_machine_write_rpc.sql` | `machine_write_note` RPC for agent-authored writes. |
| `20260409000006_version_history_rpc.sql` | `get_note_version_history` and `restore_note_version` RPCs. |
| `20260409000007_lifecycle_rpc.sql` | `create_branch`, `promote_branch`, `discard_branch` atomic RPCs. |
| `20260409000008_relationship_contract_correction.sql` | FK + constraint corrections from v1 review. |
| `20260409000009_vocabulary_normalization.sql` | Enum normalization for note kinds and statuses. |
| `20260409000010_export_artifacts_bucket.sql` | Supabase Storage bucket `export-artifacts` for workspace exports. |
| `20260409000011_generated_note_promotion.sql` | `generated_notes` → `notes` promotion flow. |
| `20260409000012_export_artifact_cleanup.sql` | TTL cleanup for export_artifacts. |
| `20260409000013_workspace_subscriptions.sql` | `workspace_subscriptions` table (plan, status, billing). |

### 2026-04-10 — Subscription fixes

| File | What it does |
|---|---|
| `20260410000001_fix_workspace_subscriptions.sql` | Correct FK and default values on workspace_subscriptions. |
| `20260410000002_drop_create_note_overload.sql` | Remove an overloaded `create_note` RPC that conflicted with the new versioned variant. |

### 2026-04-11 — Object model

| File | What it does |
|---|---|
| `20260411000001_object_model_tables.sql` | `workspace_objects`, `object_links`, `object_versions` — polymorphic object registry. |
| `20260411000002_object_model_rls.sql` | RLS policies for object model tables. |
| `20260411000003_workspace_objects_backfill.sql` | Backfill existing notes/boxes/folders into workspace_objects. |
| `20260411000004_object_model_rpc.sql` | RPCs: `register_workspace_object`, `link_objects`, `get_object_graph`. |
| `20260411000005_trust_extension.sql` | `object_trust_policy` — trust scoring for AI-authored objects. |
| `20260411000006_object_model_rpc_v2.sql` | Revised RPCs after the trust extension. |
| `20260411000007_expand_skill_agent_formats.sql` | Add `format` column to skills for output-type declaration. |

### 2026-04-12 — Branching, memberships, OAuth

| File | What it does |
|---|---|
| `20260412000001_skill_agent_child_containment.sql` | Skill containment rules for child agent invocations. |
| `20260412000002_tree_ordering_fix.sql` | Correct tree-ordering index for folder hierarchy. |
| `20260412000003_workspace_memberships.sql` | `workspace_memberships` table (owner/admin/member/viewer roles). Core auth gate. |
| `20260412000004_rollback_foundations.sql` | Branch rollback state machine (`rollback_status`, `rolled_back_from_branch_id`). |
| `20260412000005_rls_write_role_gate.sql` | RLS enforcement: `viewer` role cannot write content tables. |
| `20260412000006_oauth_server.sql` | OAuth 2.0 server tables: `oauth_clients`, `oauth_codes`, `oauth_tokens`, `oauth_scopes`. |
| `20260412000007_branch_package_metadata.sql` | `branch_package_metadata` — serialized branch diff snapshots. |
| `20260412000008_branch_scoped_structural_rows.sql` | Branch-local structural rows for boxes and folders. |
| `20260412000009_branch_scoped_content_rows.sql` | Branch-local notes (notes with non-null `branch_id`). |
| `20260412000010_branch_pending_ops.sql` | `pending_ops` — queue of uncommitted branch operations. |

### 2026-04-13 — Branch hardening, MCP

| File | What it does |
|---|---|
| `20260413000001_folder_branch_overrides.sql` | Per-branch folder metadata overlays. |
| `20260413000002_branch_placement_overrides.sql` | Per-branch placement (sort order) overrides. |
| `20260413000003_branch_rls_hardening.sql` | Tighten RLS on branch tables to prevent cross-branch reads. |
| `20260413000004_branch_metadata_overlays_v2.sql` | Revised metadata overlay schema after v1 review. |
| `20260413000005_note_links_and_attachments_branch_id.sql` | Add `branch_id` to note_links and box_object_attachments. |
| `20260413000006_mcp_auth_hardening.sql` | MCP endpoint auth — verify workspace membership on token. |
| `20260413000007_mcp_auth_productization.sql` | MCP token scoping and rate limit tables. |
| `20260413000008_draft_branches_promoting_status.sql` | Add `promoting` intermediate status to branch state machine. |

### 2026-04-14 — Branch lifecycle, WebAuthn, partitioning

| File | What it does |
|---|---|
| `20260414000001_ai_authored_branches.sql` | Mark branches as agent-authored (`is_ai_authored` flag). |
| `20260414000002_branch_rollback_status.sql` | Rollback status state machine fixes. |
| `20260414000003_branch_reviews.sql` | `branch_reviews` table — reviewer assignments and approval state. |
| `20260414000004_branch_lifecycle.sql` | `branch_lifecycle_events` audit log for branch state transitions. |
| `20260414000006_branch_promotion_gates.sql` | `branch_promotion_gates` — pluggable pre-promotion checks. |
| `20260414000007_branch_promotion_partial_origin.sql` | Track which notes were promoted vs. left behind. |
| `20260414000008_fts_skills_agents_files.sql` | FTS indexes for skills, agents, and files tables. |
| `20260414000009_partition_append_only_tables.sql` | Partition `note_versions` and `audit_events` by month for scale. |
| `20260414000010_webauthn_credentials.sql` | `webauthn_credentials` table for passkey storage. |
| `20260414000011_auto_partition_maintenance.sql` | Cron-driven automatic partition creation. |
| `20260414000012_webauthn_challenge_ttl.sql` | TTL cleanup for WebAuthn challenges. |
| `20260414000013_rate_limit_cleanup.sql` | Expired rate-limit row cleanup. |
| `20260414000014_missing_indexes.sql` | Fill-in indexes found during load testing. |

### 2026-04-15 — Semantic search, social, analytics

| File | What it does |
|---|---|
| `20260415000001_semantic_search.sql` | `pgvector` extension + `note_embeddings` table for semantic search. |
| `20260415000002_workspace_invitations.sql` | `workspace_invitations` table (email invite flow). |
| `20260415000004_link_suggestions.sql` | `link_suggestions` — AI-proposed note links awaiting approval. |
| `20260415000005_note_templates.sql` | `note_templates` table for reusable note starters. |
| `20260415000006_activity_feed.sql` | `activity_events` table — workspace activity feed. |
| `20260415000007_note_comments.sql` | `note_comments` table — threaded note comments. |
| `20260415000008_workspace_analytics.sql` | `workspace_analytics_snapshots` — daily aggregation snapshots. |
| `20260415000010_content_webhooks.sql` | `content_webhooks` — outbound webhooks on note events. |
| `20260415000011_v3_rls_hardening.sql` | V3 security pass: tighten RLS across new tables. |
| `20260415000012_v3_deep_audit_fixes.sql` | Fix audit event capture for edge cases found in v3 testing. |

### 2026-04-19 — Workspace operator (Pog)

| File | What it does |
|---|---|
| `20260419000001_workspace_operator_runs.sql` | `workspace_operator_runs` — per-run records for the Modal AI agent. |
| `20260419000002_user_agent_preferences.sql` | `user_agent_preferences` — per-user agent config (model, verbosity). |
| `20260419000003_workspace_operator_usage.sql` | `workspace_operator_usage` — token + cost aggregation per run. |
| `20260419000004_business_tier.sql` | Business subscription tier columns on `workspace_subscriptions`. |
| `20260419000005_operator_run_token_counts.sql` | Token count columns on `workspace_operator_runs`. |

### 2026-04-20 — Operator capabilities

| File | What it does |
|---|---|
| `20260420000001_operator_cancel_and_budget.sql` | Cancellation flag + per-workspace operator token budget. |
| `20260420000002_operator_artifacts_and_prompts.sql` | `operator_artifacts` (run outputs) + `operator_prompts` (system prompt overrides). |
| `20260420000003_operator_notification_preferences.sql` | User notification preference columns for operator runs. |
| `20260420000004_operator_api_rate_limits.sql` | Per-workspace API rate limit config for operator tool calls. |
| `20260420000005_operator_cascade_fix.sql` | Fix FK cascades on operator_artifacts after delete. |
| `20260420000006_operator_notification_granularity.sql` | Fine-grained notification types (started/completed/failed). |
| `20260420000007_operator_prompts_ordering.sql` | Ordering column on operator_prompts for priority stacking. |
| `20260420000008_pog_instructions.sql` | `workspace.agent_instructions` column — free-text Pog persona override. |

### 2026-04-21 — Agent harness, public sharing, security

| File | What it does |
|---|---|
| `20260421000002_v3_agent_harness.sql` | Agent harness tables: `browsing_sessions`, tool auth columns. |
| `20260421000003_box_public_sharing.sql` | `boxes.is_public` + share token support for public box links. |
| `202604210001_v3_critical_security_and_partition_fixes.sql` | Security patches and partition fix (out-of-sequence; applied after `000003`). |

### 2026-04-22 — Skills, agent triggers

| File | What it does |
|---|---|
| `20260422000001_pinned_skills.sql` | `skills.is_pinned` — pin skills to the top of the skill picker. |
| `20260422000002_agent_triggers.sql` | `agent_triggers` table — cron and note-event triggers for agents and workflows. |

### 2026-04-23 — Knowledge graph, insights

| File | What it does |
|---|---|
| `20260423000001_knowledge_graph.sql` | `entities`, `entity_mentions`, `entity_edges` tables + RLS + indexes. |
| `20260423000002_knowledge_graph_safety.sql` | `increment_entity_mention_count` atomic RPC + `workspace.knowledge_graph_enabled` flag + entity embedding column. |
| `20260423000003_kg_backfill_jobs.sql` | `kg_backfill_jobs` table for tracking async KG backfill runs. |
| `20260423000004_atomic_insights.sql` | `insights` table — atomic claims (fact/decision/insight/question/action) extracted from notes. |
| `20260423000005_agent_trigger_runs.sql` | `agent_trigger_runs` table — execution records for agent trigger firings. |

### 2026-04-24 — Web agents

| File | What it does |
|---|---|
| `20260424000001_web_agents.sql` | `web_tool_usage`, `browsing_sessions`, `browsing_session_steps`, `web_citations` + `workspaces.web_tool_budget_cents`. |

### 2026-04-25 — Sub-agents

| File | What it does |
|---|---|
| `20260425000001_subagents.sql` | `skills.is_subagent/subagent_tools/subagent_max_turns` columns + `subagent_invocations` table. |

### 2026-04-26 — Streaming + inline AI

| File | What it does |
|---|---|
| `20260426000001_streaming_and_inline_ai.sql` | `inline_command_invocations` table for the slash-command AI pipeline. |

### 2026-04-27 — Workflows

| File | What it does |
|---|---|
| `20260427000001_workflows.sql` | `workflows`, `workflow_nodes`, `workflow_edges`, `workflow_runs`, `workflow_node_runs` tables + RLS. |

### 2026-04-28 — Workflow schedule triggers

| File | What it does |
|---|---|
| `20260428000001_workflow_schedule_triggers.sql` | Link `workflows.trigger_id → agent_triggers` for cron-scheduled workflow execution. |

---

## Frequently needed operations

### Check which migrations have been applied

```bash
supabase migration list
```

This compares local files against the `schema_migrations` table in the DB.

### Reset local DB and replay from scratch

```bash
supabase db reset
```

Drops and recreates the local DB, replaying all migrations. Use only on the local dev instance.

### Inspect a migration before pushing

```bash
supabase db push --dry-run
```

Prints the SQL that would be executed without applying it.
