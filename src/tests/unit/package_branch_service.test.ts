import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for package_branch_service.
 *
 * Covers the four invariants that make Skills and Agents feel
 * coherent as package drafts on a branch:
 *
 *   1. A child-file edit on a branch is attributed to the parent
 *      Skill/Agent via computePackageBranchMembership's join against
 *      files.parent_skill_id / files.parent_agent_id.
 *   2. Package metadata overlay round-trips via upsertPackageMetadataOverlay
 *      + getPackageMetadataOverlay (agent-only fields are rejected
 *      when passed for a skill).
 *   3. applyPackageMetadataOverlay patches only the declared overlay
 *      fields and leaves the rest of the row untouched.
 *   4. getPackageDraftState returns null when the branch has no
 *      relevant state at all (canonical source + children + overlay
 *      all absent).
 */

vi.mock("@/server/services/branch_service");

import {
  computePackageBranchMembership,
  upsertPackageMetadataOverlay,
  getPackageMetadataOverlay,
  applyPackageMetadataOverlay,
  getPackageDraftState,
  branchableMetadataFieldsFor,
} from "@/server/services/package_branch_service";
import * as branchService from "@/server/services/branch_service";

const BRANCH_ID = "branch-1";
const SKILL_ID = "skill-1";
const AGENT_ID = "agent-1";

// ─── Mock builder ────────────────────────────────────────────────────────────

function makeMockSupabase(opts: {
  filesInParent?: Array<{ id: string; name: string; path_cache: string | null; parent_skill_id?: string | null; parent_agent_id?: string | null }>;
  existingOverlay?: Record<string, unknown> | null;
  branchHeadCanonicalVersionId?: string | null;
} = {}) {
  const {
    filesInParent = [],
    existingOverlay = null,
    branchHeadCanonicalVersionId = null,
  } = opts;
  const inserts: Record<string, Record<string, unknown>[]> = {};
  const upserts: Record<string, Record<string, unknown>[]> = {};

  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { filters[col] = val; return builder; };
    builder.in = (col: string, vals: unknown[]) => { filters[col] = vals; return builder; };
    builder.maybeSingle = async () => {
      if (table === "branch_package_metadata") {
        return { data: existingOverlay, error: null };
      }
      if (table === "branch_heads") {
        return {
          data: branchHeadCanonicalVersionId
            ? { version_id: branchHeadCanonicalVersionId }
            : null,
          error: null,
        };
      }
      return { data: null, error: null };
    };
    // Handle the `files` list query (select + in + eq).
    builder.then = async (resolve: (v: { data: unknown[]; error: null }) => void) => {
      if (table === "files") {
        // Respect the parent filter the caller applied.
        const parentSkill = filters["parent_skill_id"];
        const parentAgent = filters["parent_agent_id"];
        const ids = filters["id"] as string[] | undefined;
        const matches = filesInParent.filter((f) => {
          if (ids && !ids.includes(f.id)) return false;
          if (parentSkill && f.parent_skill_id !== parentSkill) return false;
          if (parentAgent && f.parent_agent_id !== parentAgent) return false;
          return true;
        });
        resolve({ data: matches, error: null });
      } else {
        resolve({ data: [], error: null });
      }
    };
    builder.upsert = (payload: Record<string, unknown>) => {
      upserts[table] = upserts[table] ?? [];
      upserts[table].push(payload);
      return {
        select: () => ({
          single: async () => ({
            data: {
              id: "overlay-row",
              ...payload,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            error: null,
          }),
        }),
      };
    };
    builder.insert = (payload: Record<string, unknown>) => {
      inserts[table] = inserts[table] ?? [];
      inserts[table].push(payload);
      return builder;
    };
    return builder;
  }
  return { client: { from: fromFn } as never, inserts, upserts };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("branchable metadata fields", () => {
  it("exposes skill vs agent field lists", () => {
    expect(branchableMetadataFieldsFor("skill")).toEqual(["name", "description", "tags", "summary"]);
    expect(branchableMetadataFieldsFor("agent")).toEqual([
      "name", "description", "tags", "summary", "agent_type", "model_hint", "system_prompt",
    ]);
  });
});

describe("computePackageBranchMembership", () => {
  it("returns only child files whose parent_skill_id matches the target package", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      { id: "h1", branch_id: BRANCH_ID, object_type: "file", object_id: "file-1", version_id: "v1", updated_at: "" } as never,
      { id: "h2", branch_id: BRANCH_ID, object_type: "file", object_id: "file-2", version_id: "v2", updated_at: "" } as never,
      { id: "h3", branch_id: BRANCH_ID, object_type: "note", object_id: "note-1", version_id: "vn", updated_at: "" } as never,
    ]);
    const { client } = makeMockSupabase({
      filesInParent: [
        { id: "file-1", name: "a.py", path_cache: "a.py", parent_skill_id: SKILL_ID },
        { id: "file-2", name: "b.py", path_cache: "b.py", parent_skill_id: "other-skill" },
      ],
    });
    const result = await computePackageBranchMembership(client, BRANCH_ID, "skill", SKILL_ID);
    expect(result).toHaveLength(1);
    expect(result[0].fileId).toBe("file-1");
    expect(result[0].fileName).toBe("a.py");
  });

  it("returns empty when no file heads exist on the branch", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      { id: "h1", branch_id: BRANCH_ID, object_type: "note", object_id: "n", version_id: "v", updated_at: "" } as never,
    ]);
    const { client } = makeMockSupabase();
    const result = await computePackageBranchMembership(client, BRANCH_ID, "skill", SKILL_ID);
    expect(result).toEqual([]);
  });

  it("picks agent parents for an agent package query", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      { id: "h1", branch_id: BRANCH_ID, object_type: "file", object_id: "file-1", version_id: "v1", updated_at: "" } as never,
    ]);
    const { client } = makeMockSupabase({
      filesInParent: [{ id: "file-1", name: "run.ts", path_cache: "run.ts", parent_agent_id: AGENT_ID }],
    });
    const result = await computePackageBranchMembership(client, BRANCH_ID, "agent", AGENT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].fileId).toBe("file-1");
  });
});

describe("upsertPackageMetadataOverlay", () => {
  it("writes skill-legal fields and silently drops agent-only fields for a skill package", async () => {
    const { client, upserts } = makeMockSupabase();
    await upsertPackageMetadataOverlay(client, {
      branchId: BRANCH_ID,
      packageType: "skill",
      packageId: SKILL_ID,
      description: "drafted desc",
      tags: ["draft", "wip"],
      summary: "summary",
      // These three are agent-only and should NOT be persisted:
      agent_type: "reasoning",
      model_hint: "claude-sonnet-4-6",
      system_prompt: "YOU ARE A HELPFUL AGENT",
    });
    expect(upserts.branch_package_metadata).toHaveLength(1);
    const payload = upserts.branch_package_metadata![0];
    expect(payload.description).toBe("drafted desc");
    expect(payload.tags).toEqual(["draft", "wip"]);
    expect(payload.summary).toBe("summary");
    expect(payload).not.toHaveProperty("agent_type");
    expect(payload).not.toHaveProperty("model_hint");
    expect(payload).not.toHaveProperty("system_prompt");
  });

  it("writes every legal field for an agent package", async () => {
    const { client, upserts } = makeMockSupabase();
    await upsertPackageMetadataOverlay(client, {
      branchId: BRANCH_ID,
      packageType: "agent",
      packageId: AGENT_ID,
      description: "drafted desc",
      tags: ["ai"],
      summary: "summary",
      agent_type: "reasoning",
      model_hint: "claude-sonnet-4-6",
      system_prompt: "prompt body",
    });
    const payload = upserts.branch_package_metadata![0];
    expect(payload.agent_type).toBe("reasoning");
    expect(payload.model_hint).toBe("claude-sonnet-4-6");
    expect(payload.system_prompt).toBe("prompt body");
  });
});

describe("getPackageMetadataOverlay", () => {
  it("returns null when no overlay row exists", async () => {
    const { client } = makeMockSupabase({ existingOverlay: null });
    const result = await getPackageMetadataOverlay(client, BRANCH_ID, "skill", SKILL_ID);
    expect(result).toBeNull();
  });

  it("returns the overlay row when it exists", async () => {
    const fakeOverlay = {
      id: "ov-1",
      branch_id: BRANCH_ID,
      package_type: "skill",
      package_id: SKILL_ID,
      description: "drafted",
      tags: null,
      summary: null,
      agent_type: null,
      model_hint: null,
      system_prompt: null,
      created_at: "",
      updated_at: "",
    };
    const { client } = makeMockSupabase({ existingOverlay: fakeOverlay });
    const result = await getPackageMetadataOverlay(client, BRANCH_ID, "skill", SKILL_ID);
    expect(result).toEqual(fakeOverlay);
  });
});

describe("applyPackageMetadataOverlay", () => {
  it("patches declared overlay fields and leaves the rest of the row alone", () => {
    const row = {
      id: SKILL_ID,
      name: "My Skill",
      description: "main desc",
      tags: ["main", "tags"],
      summary: "main summary",
      source_content: "canonical source unchanged",
    };
    const overlay = {
      id: "ov",
      branch_id: BRANCH_ID,
      package_type: "skill" as const,
      package_id: SKILL_ID,
      name: null,
      description: "drafted",
      tags: ["drafted"],
      summary: null, // null means "keep main" in our semantics; unchanged below
      agent_type: null,
      model_hint: null,
      system_prompt: null,
      created_at: "",
      updated_at: "",
    };
    const patched = applyPackageMetadataOverlay(row, overlay);
    expect(patched.description).toBe("drafted");
    expect(patched.tags).toEqual(["drafted"]);
    // source_content is never touched by the overlay — canonical
    // source goes through object_versions / branch_heads, not the
    // overlay table.
    expect(patched.source_content).toBe("canonical source unchanged");
    // name overlay was null (no override); main value preserved.
    expect(patched.name).toBe("My Skill");
  });
});

describe("getPackageDraftState", () => {
  it("returns null when the branch has no package state at all", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([]);
    const { client } = makeMockSupabase({
      existingOverlay: null,
      branchHeadCanonicalVersionId: null,
      filesInParent: [],
    });
    const result = await getPackageDraftState(client, BRANCH_ID, "skill", SKILL_ID);
    expect(result).toBeNull();
  });

  it("returns state when at least one element is non-empty", async () => {
    vi.mocked(branchService.listBranchHeads).mockResolvedValue([
      { id: "h1", branch_id: BRANCH_ID, object_type: "file", object_id: "file-1", version_id: "v1", updated_at: "" } as never,
    ]);
    const { client } = makeMockSupabase({
      filesInParent: [{ id: "file-1", name: "a.py", path_cache: "a.py", parent_skill_id: SKILL_ID }],
      branchHeadCanonicalVersionId: "canonical-v",
    });
    const result = await getPackageDraftState(client, BRANCH_ID, "skill", SKILL_ID);
    expect(result).not.toBeNull();
    expect(result!.canonicalSourceVersionId).toBe("canonical-v");
    expect(result!.childHeads).toHaveLength(1);
    expect(result!.childHeads[0].fileId).toBe("file-1");
  });
});
