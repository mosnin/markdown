# src/server/services

Business logic layer for Context Store.

Services orchestrate repositories, enforce product/domain rules, and provide the
stable contracts consumed by route handlers and server actions.

## What is implemented now

The service layer is broad and active. Representative areas include:

- Core content + lifecycle:
  - `note_service.ts`, `file_service.ts`, `skill_service.ts`, `agent_service.ts`
  - `lifecycle_service.ts`, `version_history_service.ts`, `restore_service.ts`
- Branch system:
  - `branch_service.ts`, `branch_diff_service.ts`, `branch_rebase_service.ts`
  - `branch_review_service.ts`, `branch_lifecycle_service.ts`, `change_set_service.ts`
- MCP/OAuth + connection auth:
  - `oauth_client_service.ts`, `oauth_token_service.ts`, `oauth_scope_service.ts`
  - `connection_service.ts`
- Operator/agent runtime:
  - `workspace_operator_service.ts`, `workspace_operator_runs_service.ts`
  - `workspace_operator_quota_service.ts`, `operator_rate_limit_service.ts`
  - `tool_call_approvals_service.ts`, `operator_notifications_service.ts`
- Retrieval/search/intelligence:
  - `context_bundle_service.ts`, `workspace_search_service.ts`
  - `embedding_service.ts`, `knowledge_graph_service.ts`, `graph_rag_service.ts`
- Integrations/automation:
  - `browserbase_service.ts`, `exa_search_service.ts`
  - `workspace_export_service.ts`, `import_service.ts`, `content_webhook_service.ts`

## Conventions

- Inputs are typed values, not raw `Request`/`Response` objects.
- Services may compose other services and repositories.
- Authorization/role checks are explicit at service or action boundaries.
- Services should be deterministic where possible and side effects should be
  explicit (audit events, notifications, async jobs).

## Testing

Most critical services are covered by unit and/or integration tests under
`src/tests/unit` and `src/tests/integration`.
