/**
 * MCP write-tool conflict-resolution helper
 * ----------------------------------------------------------------------------
 *
 * **README for future MCP-write authors**
 *
 * Every MCP write tool that supports optimistic concurrency (i.e. takes an
 * `expected_version_id` argument and refuses to overwrite a moved target)
 * must report a version conflict using the **single shape defined here**.
 *
 * Why centralize?
 *   - Tools C1 (`update_note`) and C2 (`apply_patch`) both detect mismatches
 *     between the caller's `expected_version_id` and the server's current
 *     head. They previously each defined their own response object.
 *   - Future tools (C5: `update_skill`, `update_agent`) will need the same
 *     contract. Without a single source of truth, MCP clients see slightly
 *     different shapes per tool — making conflict-resolution UX brittle.
 *
 * How to use:
 *   1. In your write tool, read the current row (id, updated_at, content,
 *      change_origin) **before** writing.
 *   2. Call `assertExpectedVersion(args.expected_version_id, currentRow.id)`.
 *      If it throws `VersionConflictError`, catch it and return the result
 *      of `buildVersionConflict(currentRow)` as the tool response payload.
 *   3. Do **not** define a local `version_conflict` shape anywhere else —
 *      import {@link VersionConflictResponse} from this module instead.
 *
 * This module is pure: no I/O, no Supabase, no side effects. It is safe to
 * import from any layer (tools, services, repositories, tests).
 */

/**
 * Recognized provenance values for the current canonical content.
 *
 * Mirrors the `change_origin` column on note/skill/agent version tables.
 * `null` means the row predates change_origin tracking or was migrated in.
 */
export type ChangeOrigin =
  | "human"
  | "machine_proposed"
  | "machine_generated"
  | "agent"
  | null;

/**
 * The canonical shape returned by every MCP write tool when the caller's
 * `expected_version_id` does not match the server's current head.
 *
 * **Single source of truth.** Do not redefine this shape in any other file.
 *
 * `current` carries everything the caller needs to resolve the conflict
 * without a follow-up read: the new version id, when it changed, the full
 * content, and whether the change came from a human or a machine.
 */
export interface VersionConflictResponse {
  ok: false;
  code: "version_conflict";
  message: string;
  current: {
    version_id: string;
    updated_at: string;
    content: string;
    change_origin: ChangeOrigin;
  };
}

/**
 * Minimal shape of a "current version" row that callers must pass in.
 *
 * Repositories typically return more columns; pick these four out before
 * calling {@link buildVersionConflict}.
 */
export interface CurrentVersionSnapshot {
  id: string;
  updated_at: string;
  content: string;
  change_origin: ChangeOrigin;
}

/**
 * Tagged error thrown by {@link assertExpectedVersion} when the caller's
 * `expected_version_id` does not match the server's current head.
 *
 * Callers in MCP write tools should catch this specifically and convert
 * it to a {@link VersionConflictResponse} via {@link buildVersionConflict}.
 *
 * Exported so callers can `instanceof VersionConflictError`.
 */
export class VersionConflictError extends Error {
  /** Discriminator for structural code that can't rely on `instanceof`. */
  readonly code = "version_conflict" as const;
  readonly expected: string;
  readonly current: string;

  constructor(expected: string, current: string) {
    super(
      `Version conflict: expected ${expected} but current is ${current}`
    );
    this.name = "VersionConflictError";
    this.expected = expected;
    this.current = current;
    // Preserve prototype chain across transpile targets (ES2017).
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

/**
 * Assert that the caller's `expected_version_id` matches the current head.
 *
 * Uses a TS assertion signature so that, after the call, the compiler treats
 * `expected` as confirmed-equal-to `currentId` for the rest of the block.
 *
 * @throws {VersionConflictError} when `expected !== currentId`.
 */
export function assertExpectedVersion(
  expected: string,
  currentId: string
): asserts expected is string {
  if (expected !== currentId) {
    throw new VersionConflictError(expected, currentId);
  }
}

/**
 * Build the canonical {@link VersionConflictResponse} payload from a freshly
 * read snapshot of the current canonical row.
 *
 * Callers should:
 *   - Pass the snapshot taken **after** detecting the conflict, so the
 *     caller sees the latest state.
 *   - Return the result directly as their tool's structured response.
 */
export function buildVersionConflict(
  currentVersion: CurrentVersionSnapshot
): VersionConflictResponse {
  return {
    ok: false,
    code: "version_conflict",
    message:
      "The target was modified by another writer. " +
      "Re-read the current version, reconcile your changes, and retry " +
      "with the new expected_version_id.",
    current: {
      version_id: currentVersion.id,
      updated_at: currentVersion.updated_at,
      content: currentVersion.content,
      change_origin: currentVersion.change_origin,
    },
  };
}
