import { describe, it, expect, vi } from "vitest";

/**
 * Branch-aware write/read tests for files, skills, and agents.
 *
 * Mirrors the Notes test at `branch_semantics.test.ts` but
 * parameterised across the three versioned object types that share
 * the `object_versions` table. The core invariant we're defending:
 *
 *   Branch writes create a new object_versions row and upsert a
 *   branch_heads entry. They DO NOT mutate the canonical
 *   files / skills / agents row.
 *
 * These tests use the same lightweight mock-Supabase pattern used by
 * the Notes tests — no live DB, but every builder call is captured
 * so the invariants are asserted on actual side-effects.
 */

vi.mock("@/server/repositories/object_version_repository");
vi.mock("@/server/repositories/audit_event_repository");

import {
  updateObjectContentOnBranch,
  resolveBranchObjectVersion,
  type VersionedObjectType,
} from "@/server/services/object_branch_service";
import * as versionRepo from "@/server/repositories/object_version_repository";

const WORKSPACE_ID = "ws-1";
const USER_ID = "user-1";
const BRANCH_ID = "branch-1";
const PRIOR_VERSION_ID = "ver-main";

function makeMockSupabase(opts: {
  branchStatus?: string;
  branchWorkspace?: string;
  existingHead?: string | null;
  branchVersionRow?: { source_content: string; content_bytes: number; version_number: number } | null;
} = {}) {
  const {
    branchStatus = "open",
    branchWorkspace = WORKSPACE_ID,
    existingHead = null,
    branchVersionRow = null,
  } = opts;
  const inserts: Record<string, Array<Record<string, unknown>>> = {};
  const updates: Record<string, Array<{ match: Record<string, unknown>; patch: Record<string, unknown> }>> = {};

  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};

    builder.eq = (col: string, val: unknown) => { filters[col] = val; return builder; };

    const selectBuilder = () => {
      const sb: Record<string, unknown> = {
        eq: (col: string, val: unknown) => { filters[col] = val; return selectBuilder(); },
        maybeSingle: async () => {
          if (table === "files" || table === "skills" || table === "agents") {
            return {
              data: {
                id: filters.id,
                workspace_id: WORKSPACE_ID,
                status: "active",
                current_version_id: PRIOR_VERSION_ID,
              },
              error: null,
            };
          }
          if (table === "draft_branches") {
            return {
              data: { id: BRANCH_ID, workspace_id: branchWorkspace, status: branchStatus },
              error: null,
            };
          }
          if (table === "branch_heads") {
            return existingHead ? { data: { version_id: existingHead }, error: null } : { data: null, error: null };
          }
          if (table === "object_versions") {
            return { data: branchVersionRow, error: null };
          }
          return { data: null, error: null };
        },
      };
      return sb;
    };
    builder.select = selectBuilder;

    builder.insert = (payload: Record<string, unknown>) => {
      inserts[table] = inserts[table] ?? [];
      inserts[table].push(payload);
      return { select: () => ({ single: async () => ({ data: payload, error: null }) }) };
    };
    builder.upsert = (payload: Record<string, unknown>) => {
      inserts[`${table}:upsert`] = inserts[`${table}:upsert`] ?? [];
      inserts[`${table}:upsert`].push(payload);
      return { select: () => ({ single: async () => ({ data: payload, error: null }) }) };
    };
    builder.update = (patch: Record<string, unknown>) => {
      const capturedFilters: Record<string, unknown> = {};
      const up: Record<string, unknown> = {};
      up.eq = (col: string, val: unknown) => {
        capturedFilters[col] = val;
        return up;
      };
      up.then = async (resolve: (v: { error: null }) => void) => {
        updates[table] = updates[table] ?? [];
        updates[table].push({ match: capturedFilters, patch });
        resolve({ error: null });
      };
      return up;
    };
    return builder;
  }

  return { client: { from: fromFn } as never, inserts, updates };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

const OBJECT_TYPES: VersionedObjectType[] = ["file", "skill", "agent"];

describe.each(OBJECT_TYPES)(
  "branch-aware writes (%s)",
  (objectType) => {
    const CANONICAL_TABLE =
      objectType === "file" ? "files" :
      objectType === "skill" ? "skills" : "agents";

    it("writes a new object_version, upserts branch_heads, never mutates main", async () => {
      const { client, inserts, updates } = makeMockSupabase();
      const OBJECT_ID = `${objectType}-1`;

      vi.mocked(versionRepo.getLatestObjectVersion).mockResolvedValue({
        version_number: 4,
      } as never);
      vi.mocked(versionRepo.createObjectVersion).mockResolvedValue({
        id: `ver-branch-${objectType}`,
        version_number: 5,
      } as never);

      const result = await updateObjectContentOnBranch(
        client, USER_ID, WORKSPACE_ID, BRANCH_ID,
        objectType, OBJECT_ID,
        { sourceContent: "new body" }
      );

      expect(result).toEqual({
        version_id: `ver-branch-${objectType}`,
        version_number: 5,
        branch_id: BRANCH_ID,
        object_type: objectType,
        object_id: OBJECT_ID,
      });

      expect(vi.mocked(versionRepo.createObjectVersion)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          object_type: objectType,
          object_id: OBJECT_ID,
          parent_version_id: PRIOR_VERSION_ID,
          version_number: 5,
          source_content: "new body",
          change_origin: "human_edit",
          diff_summary: expect.objectContaining({ branch_write: true, branch_id: BRANCH_ID }),
        })
      );

      // branch_heads upserted with the right polymorphic pointer.
      expect(inserts["branch_heads:upsert"]).toBeDefined();
      expect(inserts["branch_heads:upsert"]![0]).toMatchObject({
        branch_id: BRANCH_ID,
        object_type: objectType,
        object_id: OBJECT_ID,
        version_id: `ver-branch-${objectType}`,
      });

      // CRITICAL INVARIANT: the canonical row is never updated during
      // a branch write. Its current_version_id must remain at
      // PRIOR_VERSION_ID until an explicit promote.
      expect(updates[CANONICAL_TABLE] ?? []).toEqual([]);
    });

    it("rejects a non-open branch", async () => {
      const { client } = makeMockSupabase({ branchStatus: "discarded" });
      await expect(
        updateObjectContentOnBranch(
          client, USER_ID, WORKSPACE_ID, BRANCH_ID,
          objectType, `${objectType}-1`,
          { sourceContent: "x" }
        )
      ).rejects.toThrow(/not open/);
    });

    it("rejects a branch in a different workspace", async () => {
      const { client } = makeMockSupabase({ branchWorkspace: "other-ws" });
      await expect(
        updateObjectContentOnBranch(
          client, USER_ID, WORKSPACE_ID, BRANCH_ID,
          objectType, `${objectType}-1`,
          { sourceContent: "x" }
        )
      ).rejects.toThrow();
    });
  }
);

// ─── Reads ───────────────────────────────────────────────────────────────────

describe.each(OBJECT_TYPES)(
  "branch-aware reads (%s)",
  (objectType) => {
    it("returns the branch head version when one exists", async () => {
      const { client } = makeMockSupabase({
        existingHead: "ver-branch-head",
        branchVersionRow: {
          source_content: "branch body",
          content_bytes: 11,
          version_number: 7,
        },
      });
      const result = await resolveBranchObjectVersion(
        client, BRANCH_ID, objectType, `${objectType}-1`
      );
      expect(result?.source_content).toBe("branch body");
      expect(result?.version_number).toBe(7);
    });

    it("returns null when the branch has no head for the object (falls through to main)", async () => {
      const { client } = makeMockSupabase({ existingHead: null });
      const result = await resolveBranchObjectVersion(
        client, BRANCH_ID, objectType, `${objectType}-1`
      );
      expect(result).toBeNull();
    });

    it("returns null when branchId is null (plain main read)", async () => {
      const { client } = makeMockSupabase();
      const result = await resolveBranchObjectVersion(
        client, null, objectType, `${objectType}-1`
      );
      expect(result).toBeNull();
    });
  }
);
