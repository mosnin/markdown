# src/server/repositories

Data-access layer for Context Store.

Repositories wrap Supabase queries and return typed domain shapes. This layer is
implemented and contains the majority of table-level read/write contracts.

## What is implemented now

Representative repositories include:

- Core objects: `note_repository.ts`, `file_repository.ts`, `skill_repository.ts`,
  `agent_repository.ts`, `workspace_object_repository.ts`
- Structure and links: `box_repository.ts`, `folder_repository.ts`,
  `note_link_repository.ts`, `object_link_repository.ts`,
  `box_object_attachment_repository.ts`
- Versioning and rollback: `note_version_repository.ts`,
  `object_version_repository.ts`, `workflow_run_repository.ts`
- Identity/access/integration: `workspace_repository.ts`,
  `workspace_membership_repository.ts`, `connection_repository.ts`
- Intelligence/ops: `entity_repository.ts`, `entity_edge_repository.ts`,
  `entity_mention_repository.ts`, `kg_backfill_job_repository.ts`,
  `audit_event_repository.ts`

## Conventions

- Keep repositories focused on persistence concerns.
- Do not encode product policy/business workflows here.
- Return typed rows/models expected by services.
- Use explicit filters for workspace/ownership scoping; do not rely on implicit context.

## Notes

Some repository modules include branch-aware read overlays and lifecycle helpers;
that behavior should remain data-contract focused, with higher-order policy in
services.
