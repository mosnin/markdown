import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for rollback safety in version_history_service.ts — Files, Skills, Agents.
 *
 * Covers:
 * - Ownership enforcement: object must belong to the caller's workspace
 * - Version identity: rollback target must belong to the object
 * - Immutability: rollback creates a NEW version row, does not mutate history
 * - Not-found handling for missing object or version
 *
 * Pattern mirrors rollback_safety.test.ts for Notes.
 */

vi.mock("@/server/services/audit_service");

import {
  listVersionsForObject,
  getVersionForObject,
  rollbackObjectToVersion,
} from "@/server/services/version_history_service";
import * as auditService from "@/server/services/audit_service";

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-001";
const OTHER_WORKSPACE_ID = "ws-999";
const BOX_ID = "box-001";
const SKILL_ID = "skill-001";
const VERSION_ID = "version-001";
const TARGET_VERSION_ID = "version-002";
const USER_ID = "user-001";

// ─── Supabase mock factory ─────────────────────────────────────────────────────

/**
 * Supabase mock supporting:
 * - Object row fetch via from(table).select().eq().single()
 * - Box fetch via from("boxes").select().eq().single()
 * - Object versions list via from("object_versions").select().eq().eq().order().limit().offset()
 * - Single version fetch via from("object_versions").select().eq().eq().eq().single()
 * - RPC call for rollback
 */
function makeSupabase(options: {
  objectRow?: Record<string, unknown> | null;
  objectError?: boolean;
  versions?: Record<string, unknown>[];
  versionRow?: Record<string, unknown> | null;
  rpcResult?: Record<string, unknown> | null;
  rpcError?: { message: string } | null;
}) {
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "boxes") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: BOX_ID, workspace_id: WORKSPACE_ID },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "object_versions") {
        // Build the chain: .select().eq(type).eq(id)  then either:
        //   .order().range()           — for listObjectVersions
        //   .eq(versionId).single()    — for getObjectVersionByObjectAndId

        const innerEq: Record<string, unknown> = {};
        const orderChain = {
          range: vi.fn().mockResolvedValue({
            data: options.versions ?? [],
            error: null,
          }),
        };
        const thirdEq = {
          single: vi.fn().mockResolvedValue({
            data: options.versionRow ?? null,
            error: options.versionRow ? null : { message: "not found" },
          }),
        };
        // After two .eq() calls, the third .eq() is for versionId, and .order() is for list
        Object.assign(innerEq, {
          order: vi.fn().mockReturnValue(orderChain),
          eq: vi.fn().mockReturnValue(thirdEq),
        });

        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(innerEq),
            }),
          }),
        };
      }
      // skills / agents / files table
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: options.objectRow ?? null,
              error: (options.objectError || !options.objectRow) ? { message: "not found" } : null,
            }),
          }),
        }),
      };
    }),
    rpc: vi.fn().mockResolvedValue({
      data: options.rpcResult ?? { new_version_id: "version-003", version_number: 3 },
      error: options.rpcError ?? null,
    }),
  } as unknown as Parameters<typeof rollbackObjectToVersion>[0];

  return supabase;
}

// ─── Row factories ─────────────────────────────────────────────────────────────

function makeSkillRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SKILL_ID,
    name: "my-skill",
    status: "active",
    box_id: null,
    is_reusable: true,
    workspace_id: WORKSPACE_ID,
    source_content: "# original content",
    current_version_id: VERSION_ID,
    ...overrides,
  };
}

function makeVersionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VERSION_ID,
    object_type: "skill",
    object_id: SKILL_ID,
    version_number: 1,
    source_content: "# old content",
    content_bytes: 15,
    actor_type: "user",
    actor_id: USER_ID,
    change_origin: "human_edit",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditObjectRollback).mockResolvedValue(undefined as never);
});

// ─── listVersionsForObject ────────────────────────────────────────────────────

describe("listVersionsForObject — ownership", () => {
  it("throws if object belongs to a different workspace", async () => {
    const supabase = makeSupabase({
      objectRow: makeSkillRow({ workspace_id: OTHER_WORKSPACE_ID }),
    });

    await expect(
      listVersionsForObject(supabase, WORKSPACE_ID, "skill", SKILL_ID)
    ).rejects.toThrow("not found");
  });

  it("throws if object does not exist", async () => {
    const supabase = makeSupabase({ objectRow: null });

    await expect(
      listVersionsForObject(supabase, WORKSPACE_ID, "skill", SKILL_ID)
    ).rejects.toThrow("not found");
  });

  it("returns version list with is_current flags for owned object", async () => {
    const v1 = makeVersionRow({ id: TARGET_VERSION_ID, version_number: 1 });
    const v2 = makeVersionRow({ id: VERSION_ID, version_number: 2, change_origin: "rollback" });

    const supabase = makeSupabase({
      objectRow: makeSkillRow(),
      versions: [v2, v1],
    });

    const result = await listVersionsForObject(supabase, WORKSPACE_ID, "skill", SKILL_ID);

    expect(result.object_id).toBe(SKILL_ID);
    expect(result.object_type).toBe("skill");
    expect(result.current_version_id).toBe(VERSION_ID);
    expect(result.versions).toHaveLength(2);

    const current = result.versions.find((v) => v.id === VERSION_ID);
    expect(current?.is_current).toBe(true);
    const prior = result.versions.find((v) => v.id === TARGET_VERSION_ID);
    expect(prior?.is_current).toBe(false);
  });
});

// ─── getVersionForObject ──────────────────────────────────────────────────────

describe("getVersionForObject — version identity", () => {
  it("throws if version does not exist on this object", async () => {
    const supabase = makeSupabase({
      objectRow: makeSkillRow(),
      versionRow: null,
    });

    await expect(
      getVersionForObject(supabase, WORKSPACE_ID, "skill", SKILL_ID, "nonexistent")
    ).rejects.toThrow("Version not found");
  });

  it("returns version with is_current flag when found", async () => {
    const supabase = makeSupabase({
      objectRow: makeSkillRow(),
      versionRow: makeVersionRow(),
    });

    const result = await getVersionForObject(
      supabase, WORKSPACE_ID, "skill", SKILL_ID, VERSION_ID
    );

    expect(result.version.id).toBe(VERSION_ID);
    expect(result.is_current).toBe(true);
    expect(result.object_id).toBe(SKILL_ID);
  });
});

// ─── rollbackObjectToVersion — immutability and ownership ─────────────────────

describe("rollbackObjectToVersion — ownership enforcement", () => {
  it("throws if object belongs to a different workspace", async () => {
    const supabase = makeSupabase({
      objectRow: makeSkillRow({ workspace_id: OTHER_WORKSPACE_ID }),
    });

    await expect(
      rollbackObjectToVersion(supabase, USER_ID, WORKSPACE_ID, "skill", SKILL_ID, TARGET_VERSION_ID)
    ).rejects.toThrow("not found");
  });

  it("throws if object does not exist", async () => {
    const supabase = makeSupabase({ objectRow: null });

    await expect(
      rollbackObjectToVersion(supabase, USER_ID, WORKSPACE_ID, "skill", SKILL_ID, TARGET_VERSION_ID)
    ).rejects.toThrow("not found");
  });
});

describe("rollbackObjectToVersion — version identity", () => {
  it("throws if target version does not belong to this object", async () => {
    const supabase = makeSupabase({
      objectRow: makeSkillRow(),
      versionRow: null, // version not found for this object
    });

    await expect(
      rollbackObjectToVersion(supabase, USER_ID, WORKSPACE_ID, "skill", SKILL_ID, "other-version")
    ).rejects.toThrow("Version not found");
  });
});

describe("rollbackObjectToVersion — immutability invariant", () => {
  it("creates a new version and does not mutate history", async () => {
    const targetVersion = makeVersionRow({
      id: TARGET_VERSION_ID,
      version_number: 1,
      source_content: "# old content",
    });

    const supabase = makeSupabase({
      objectRow: makeSkillRow(),
      versionRow: targetVersion,
      rpcResult: { new_version_id: "version-003", version_number: 3 },
    });

    const result = await rollbackObjectToVersion(
      supabase,
      USER_ID,
      WORKSPACE_ID,
      "skill",
      SKILL_ID,
      TARGET_VERSION_ID
    );

    // New version ID is different from target (history preserved)
    expect(result.new_version_id).toBe("version-003");
    expect(result.restored_from_version_id).toBe(TARGET_VERSION_ID);

    // RPC was called with rollback operation
    expect(supabase.rpc).toHaveBeenCalledWith(
      "rollback_object_to_version",
      expect.objectContaining({
        p_object_type: "skill",
        p_object_id: SKILL_ID,
        p_target_version_id: TARGET_VERSION_ID,
        p_actor_id: USER_ID,
      })
    );

    // Audit event fired
    expect(auditService.auditObjectRollback).toHaveBeenCalled();
  });

  it("handles all three object types: file, skill, agent", async () => {
    for (const objectType of ["file", "skill", "agent"] as const) {
      const objectId = `${objectType}-001`;
      const targetVersion = makeVersionRow({
        id: TARGET_VERSION_ID,
        object_type: objectType,
        object_id: objectId,
      });

      const supabase = makeSupabase({
        objectRow: makeSkillRow({ id: objectId, workspace_id: WORKSPACE_ID }),
        versionRow: targetVersion,
        rpcResult: { new_version_id: "version-new", version_number: 5 },
      });

      const result = await rollbackObjectToVersion(
        supabase, USER_ID, WORKSPACE_ID, objectType, objectId, TARGET_VERSION_ID
      );

      expect(result.new_version_id).toBe("version-new");

      expect(supabase.rpc).toHaveBeenCalledWith(
        "rollback_object_to_version",
        expect.objectContaining({ p_object_type: objectType })
      );
    }
  });

  it("propagates RPC error as a thrown error", async () => {
    const targetVersion = makeVersionRow({ id: TARGET_VERSION_ID });

    const supabase = makeSupabase({
      objectRow: makeSkillRow(),
      versionRow: targetVersion,
      rpcError: { message: "Rollback failed: version conflict" },
    });

    await expect(
      rollbackObjectToVersion(supabase, USER_ID, WORKSPACE_ID, "skill", SKILL_ID, TARGET_VERSION_ID)
    ).rejects.toThrow("Rollback failed");
  });
});
