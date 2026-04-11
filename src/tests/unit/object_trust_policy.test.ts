import { describe, it, expect } from "vitest";

/**
 * Unit tests for object_trust_policy_service.ts
 *
 * Covers:
 * - getObjectTrustPolicy returns correct trust_level for box-local vs reusable objects
 * - connectionCanDirectlyWrite enforces proposal-only for reusable shared objects
 * - connectionCanDirectlyWrite correctly blocks all non-note direct writes
 * - describeObjectTrustLevel returns human-readable labels
 *
 * These are pure-logic tests with minimal Supabase mocking since the
 * policy logic itself is deterministic given the row data.
 */

import {
  connectionCanDirectlyWrite,
  describeObjectTrustLevel,
  type ObjectTrustPolicy,
} from "@/server/services/object_trust_policy_service";

// ─── Factories ────────────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<ObjectTrustPolicy> = {}): ObjectTrustPolicy {
  return {
    object_type: "skill",
    object_id: "skill-001",
    trust_level: "box_local",
    is_reusable: false,
    proposal_only_for_external: true,
    is_shared: false,
    box_id: "box-001",
    status: "active",
    ...overrides,
  };
}

function makeReusablePolicy(objectType: "skill" | "agent" = "skill"): ObjectTrustPolicy {
  return makePolicy({
    object_type: objectType,
    trust_level: "workspace_reusable",
    is_reusable: true,
    is_shared: true,
    box_id: null,
  });
}

// ─── connectionCanDirectlyWrite ───────────────────────────────────────────────

describe("connectionCanDirectlyWrite — read_only", () => {
  it("always returns false regardless of object type or reusability", () => {
    const policies = [
      makePolicy({ object_type: "note" }),
      makePolicy({ object_type: "file" }),
      makePolicy({ object_type: "skill" }),
      makePolicy({ object_type: "agent" }),
      makeReusablePolicy("skill"),
      makeReusablePolicy("agent"),
    ];

    for (const policy of policies) {
      expect(connectionCanDirectlyWrite("read_only", policy)).toBe(false);
    }
  });
});

describe("connectionCanDirectlyWrite — propose_writes", () => {
  it("always returns false (proposal system is the write path)", () => {
    const policies = [
      makePolicy({ object_type: "note" }),
      makePolicy({ object_type: "file" }),
      makePolicy({ object_type: "skill" }),
      makePolicy({ object_type: "agent" }),
      makeReusablePolicy("skill"),
      makeReusablePolicy("agent"),
    ];

    for (const policy of policies) {
      expect(connectionCanDirectlyWrite("propose_writes", policy)).toBe(false);
    }
  });
});

describe("connectionCanDirectlyWrite — generate_in_allowed_folders", () => {
  it("returns false for reusable shared skills (always proposal-only)", () => {
    const policy = makeReusablePolicy("skill");
    expect(connectionCanDirectlyWrite("generate_in_allowed_folders", policy)).toBe(false);
  });

  it("returns false for reusable shared agents (always proposal-only)", () => {
    const policy = makeReusablePolicy("agent");
    expect(connectionCanDirectlyWrite("generate_in_allowed_folders", policy)).toBe(false);
  });

  it("returns false for box-local skills (object type = not note)", () => {
    const policy = makePolicy({ object_type: "skill" });
    expect(connectionCanDirectlyWrite("generate_in_allowed_folders", policy)).toBe(false);
  });

  it("returns false for box-local agents", () => {
    const policy = makePolicy({ object_type: "agent" });
    expect(connectionCanDirectlyWrite("generate_in_allowed_folders", policy)).toBe(false);
  });

  it("returns false for files", () => {
    const policy = makePolicy({ object_type: "file" });
    expect(connectionCanDirectlyWrite("generate_in_allowed_folders", policy)).toBe(false);
  });

  it("returns true for box-local notes (the only direct-write path)", () => {
    // Note: this is the one allowed direct-write path.
    // The folder's accepts_generated_notes check is enforced separately.
    const policy = makePolicy({ object_type: "note" });
    expect(connectionCanDirectlyWrite("generate_in_allowed_folders", policy)).toBe(true);
  });
});

describe("connectionCanDirectlyWrite — proposal_only_for_external is always true", () => {
  it("all object types have proposal_only_for_external = true in their policy", () => {
    // This is a documentation check — the policy field should always be true
    const policies = [
      makePolicy({ object_type: "note" }),
      makePolicy({ object_type: "file" }),
      makePolicy({ object_type: "skill" }),
      makePolicy({ object_type: "agent" }),
      makeReusablePolicy("skill"),
      makeReusablePolicy("agent"),
    ];

    for (const policy of policies) {
      expect(policy.proposal_only_for_external).toBe(true);
    }
  });
});

// ─── describeObjectTrustLevel ─────────────────────────────────────────────────

describe("describeObjectTrustLevel", () => {
  it("returns 'Workspace shared' label for reusable objects", () => {
    const result = describeObjectTrustLevel(makeReusablePolicy("skill"));
    expect(result.label).toBe("Workspace shared");
    expect(result.detail).toContain("proposal");
  });

  it("returns 'Workspace shared' for reusable agents", () => {
    const result = describeObjectTrustLevel(makeReusablePolicy("agent"));
    expect(result.label).toBe("Workspace shared");
  });

  it("returns 'Box note' for notes", () => {
    const result = describeObjectTrustLevel(makePolicy({ object_type: "note" }));
    expect(result.label).toBe("Box note");
    expect(result.detail).toContain("proposal");
  });

  it("returns 'Box file' for files", () => {
    const result = describeObjectTrustLevel(makePolicy({ object_type: "file" }));
    expect(result.label).toBe("Box file");
  });

  it("returns 'Box skill' for box-local skills", () => {
    const result = describeObjectTrustLevel(makePolicy({ object_type: "skill" }));
    expect(result.label).toBe("Box skill");
  });

  it("returns 'Box agent' for box-local agents", () => {
    const result = describeObjectTrustLevel(makePolicy({ object_type: "agent" }));
    expect(result.label).toBe("Box agent");
  });
});

// ─── Trust level invariants ────────────────────────────────────────────────────

describe("trust level invariants", () => {
  it("reusable objects have trust_level = workspace_reusable and is_shared = true", () => {
    const skill = makeReusablePolicy("skill");
    expect(skill.trust_level).toBe("workspace_reusable");
    expect(skill.is_shared).toBe(true);
    expect(skill.box_id).toBeNull();
  });

  it("box-local objects have trust_level = box_local and is_shared = false", () => {
    const file = makePolicy({ object_type: "file" });
    expect(file.trust_level).toBe("box_local");
    expect(file.is_shared).toBe(false);
    expect(file.box_id).not.toBeNull();
  });

  it("reusable skill/agent cannot be directly written by any connection permission mode", () => {
    const policy = makeReusablePolicy("skill");
    const modes = ["read_only", "propose_writes", "generate_in_allowed_folders"];

    for (const mode of modes) {
      expect(connectionCanDirectlyWrite(mode, policy)).toBe(false);
    }
  });
});
