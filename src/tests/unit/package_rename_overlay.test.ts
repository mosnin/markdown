import { describe, it, expect } from "vitest";

/**
 * Tests for the `name` overlay extension to `branch_package_metadata`
 * that closes the `renameSkillAction` leak.
 *
 * Invariants:
 *
 *   1. `upsertPackageMetadataOverlay` accepts `name` for skills and
 *      emits a proper upsert against `branch_package_metadata`.
 *   2. `applyPackageMetadataOverlay` patches `name` on the returned
 *      row when the overlay carries a non-null name, so branch
 *      readers see the draft name rather than main's name.
 *   3. Skills overlay keeps the narrower field set: passing an
 *      agent-only field (`agent_type`) for a skill is silently
 *      dropped.
 */

import {
  upsertPackageMetadataOverlay,
  applyPackageMetadataOverlay,
  type PackageMetadataOverlay,
} from "@/server/services/package_branch_service";

const BRANCH = "branch-r";
const SKILL = "skill-1";

interface Call {
  table: string;
  op: "upsert" | "select";
  args?: Record<string, unknown>;
}

function makeSupabase(returnRow?: Record<string, unknown>) {
  const calls: Call[] = [];
  function builder(table: string) {
    let op: Call["op"] = "select";
    let args: Record<string, unknown> | undefined;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.upsert = (payload: Record<string, unknown>, opts?: unknown) => {
      op = "upsert";
      args = { payload, opts };
      return b;
    };
    b.single = async () => {
      calls.push({ table, op, args });
      return { data: returnRow ?? { id: "ov" }, error: null };
    };
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) } as never, calls };
}

describe("upsertPackageMetadataOverlay with name", () => {
  it("writes skill name overrides to branch_package_metadata", async () => {
    const { supabase, calls } = makeSupabase();
    await upsertPackageMetadataOverlay(supabase, {
      branchId: BRANCH,
      packageType: "skill",
      packageId: SKILL,
      name: "Branch Skill Name",
    });
    const up = calls.find((c) => c.op === "upsert")!;
    expect(up.table).toBe("branch_package_metadata");
    const payload = (up.args as { payload: Record<string, unknown> }).payload;
    expect(payload).toMatchObject({
      branch_id: BRANCH,
      package_type: "skill",
      package_id: SKILL,
      name: "Branch Skill Name",
    });
  });

  it("drops agent-only fields when the package_type is skill", async () => {
    const { supabase, calls } = makeSupabase();
    await upsertPackageMetadataOverlay(supabase, {
      branchId: BRANCH,
      packageType: "skill",
      packageId: SKILL,
      name: "Branch Skill",
      agent_type: "worker", // illegal for skills
    });
    const payload = (
      calls.find((c) => c.op === "upsert")!.args as { payload: Record<string, unknown> }
    ).payload;
    expect("agent_type" in payload).toBe(false);
    expect(payload.name).toBe("Branch Skill");
  });
});

describe("applyPackageMetadataOverlay with name", () => {
  const mainSkill = { id: SKILL, name: "Main Name", description: "main desc" };

  it("patches name from the overlay for skills", () => {
    const overlay: PackageMetadataOverlay = {
      branch_id: BRANCH,
      package_type: "skill",
      package_id: SKILL,
      name: "Branch Name",
      description: null,
      tags: null,
      summary: null,
      agent_type: null,
      model_hint: null,
      system_prompt: null,
      created_at: "",
      updated_at: "",
    };
    const patched = applyPackageMetadataOverlay(mainSkill, overlay);
    expect(patched.name).toBe("Branch Name");
    // description remains main's value (overlay null = no override).
    expect(patched.description).toBe("main desc");
  });
});
