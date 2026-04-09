# src/server/services

Business logic layer. Services orchestrate repositories and enforce domain rules.

## Planned contents

- `workspace_service.ts` — workspace CRUD, membership
- `box_service.ts` — box creation, access, archive
- `note_service.ts` — note create/update/version, kind enforcement
- `folder_service.ts` — folder structure within boxes
- `bundle_service.ts` — context bundle assembly and export
- `audit_service.ts` — write audit trail

## Conventions

- Services accept plain typed inputs, never raw request objects
- Services call repositories for data access
- Services call policies for authorization checks
- Services never return database rows directly — map to domain types

## Not yet implemented

Deferred to the database and business logic prompt.
