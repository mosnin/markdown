import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for lifecycle service guard logic — Files, Skills, Agents.
 *
 * Covers:
 * - Status transition guards (cannot archive already-archived, etc.)
 * - Ownership enforcement (wrong workspace_id → not found)
 * - Not-found handling (missing object)
 * - Reusable shared objects: attachments persist on archive/trash (by design)
 *
 * Pattern mirrors lifecycle_guards.test.ts for Notes.
 */

vi.mock("@/server/repositories/box_repository");
vi.mock("@/server/services/audit_service");

import {
  archiveFile,
  unarchiveFile,
  trashFile,
  restoreFile,
  archiveSkill,
  unarchiveSkill,
  trashSkill,
  restoreSkill,
  archiveAgent,
  unarchiveAgent,
  trashAgent,
  restoreAgent,
} from "@/server/services/lifecycle_service";
import * as boxRepo from "@/server/repositories/box_repository";
import * as auditService from "@/server/services/audit_service";

// getBoxById is imported by lifecycle_service for two-hop ownership checks on
// box-local objects. It is stubbed via vi.mock so we can return a valid box.
const { getBoxById } = boxRepo;

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-001";
const OTHER_WORKSPACE_ID = "ws-999";
const BOX_ID = "box-001";
const FILE_ID = "file-001";
const SKILL_ID = "skill-001";
const AGENT_ID = "agent-001";
const USER_ID = "user-001";

// ─── Supabase mock factory ─────────────────────────────────────────────────────

/**
 * Build a minimal Supabase mock that:
 * - Returns a given row for .from(...).select(...).eq(...).single()
 * - Succeeds for .from(...).update(...).eq(...)
 *
 * Each call to from() returns an object with both select and update chains
 * already configured. This avoids stateful callCount tracking.
 */
function makeSupabase(options: {
  objectRow?: Record<string, unknown> | null;
  boxRow?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
}) {
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "boxes") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: options.boxRow ?? { id: BOX_ID, workspace_id: WORKSPACE_ID, name: "Test Box" },
                error: null,
              }),
            }),
          }),
        };
      }

      // files / skills / agents — return both select and update
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: options.objectRow ?? null,
              error: options.objectRow ? null : { message: "not found" },
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: options.updateError ?? null,
          }),
        }),
      };
    }),
  } as unknown as Parameters<typeof archiveFile>[0];

  return supabase;
}

// ─── Row factories ─────────────────────────────────────────────────────────────

function makeFileRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: FILE_ID,
    name: "test.py",
    status: "active",
    box_id: BOX_ID,
    is_reusable: false,
    workspace_id: WORKSPACE_ID,
    source_content: "# test",
    ...overrides,
  };
}

function makeSkillRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SKILL_ID,
    name: "my-skill",
    status: "active",
    box_id: BOX_ID,
    is_reusable: false,
    workspace_id: WORKSPACE_ID,
    source_content: "# skill",
    ...overrides,
  };
}

function makeAgentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: AGENT_ID,
    name: "my-agent",
    status: "active",
    box_id: null,
    is_reusable: true,
    workspace_id: WORKSPACE_ID,
    source_content: "# agent",
    ...overrides,
  };
}

function makeBoxRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BOX_ID,
    workspace_id: WORKSPACE_ID,
    name: "Test Box",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getBoxById returns a valid box in the correct workspace.
  // box-local object tests rely on this for the two-hop ownership check.
  vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBoxRow() as never);
  // Silence all audit calls
  Object.keys(auditService)
    .filter((k) => k.startsWith("audit"))
    .forEach((k) => {
      vi.mocked((auditService as Record<string, unknown>)[k] as () => unknown)
        .mockResolvedValue(undefined);
    });
});

// ─── File lifecycle ───────────────────────────────────────────────────────────

describe("archiveFile", () => {
  it("archives an active box-local file", async () => {
    const supabase = makeSupabase({
      objectRow: makeFileRow(),
      boxRow: makeBoxRow(),
    });
    await expect(archiveFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID)).resolves.toBeUndefined();
  });

  it("throws if file is already archived", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ status: "archived" }) });
    await expect(archiveFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID))
      .rejects.toThrow("already archived");
  });

  it("throws if file is trashed", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ status: "trashed" }) });
    await expect(archiveFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID))
      .rejects.toThrow("Cannot archive a trashed file");
  });

  it("throws if file does not exist", async () => {
    const supabase = makeSupabase({ objectRow: null });
    await expect(archiveFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID))
      .rejects.toThrow("not found");
  });

  it("throws if file belongs to a different workspace", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ workspace_id: OTHER_WORKSPACE_ID }) });
    await expect(archiveFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID))
      .rejects.toThrow("not found");
  });
});

describe("unarchiveFile", () => {
  it("unarchives an archived file", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ status: "archived" }) });
    await expect(unarchiveFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID)).resolves.toBeUndefined();
  });

  it("throws if file is not archived", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ status: "active" }) });
    await expect(unarchiveFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID))
      .rejects.toThrow("not archived");
  });
});

describe("trashFile", () => {
  it("trashes an active file", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow() });
    await expect(trashFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID)).resolves.toBeUndefined();
  });

  it("throws if file is already trashed", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ status: "trashed" }) });
    await expect(trashFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID))
      .rejects.toThrow("already trashed");
  });
});

describe("restoreFile", () => {
  it("restores a trashed file", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ status: "trashed" }) });
    await expect(restoreFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID)).resolves.toBeUndefined();
  });

  it("throws if file is not trashed", async () => {
    const supabase = makeSupabase({ objectRow: makeFileRow({ status: "active" }) });
    await expect(restoreFile(supabase, USER_ID, WORKSPACE_ID, FILE_ID))
      .rejects.toThrow("not trashed");
  });
});

// ─── Skill lifecycle ──────────────────────────────────────────────────────────

describe("archiveSkill", () => {
  it("archives an active box-local skill", async () => {
    const supabase = makeSupabase({
      objectRow: makeSkillRow(),
      boxRow: makeBoxRow(),
    });
    await expect(archiveSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID)).resolves.toBeUndefined();
  });

  it("archives a reusable workspace skill (no box hop needed)", async () => {
    const supabase = makeSupabase({
      objectRow: makeSkillRow({ box_id: null, is_reusable: true }),
    });
    await expect(archiveSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID)).resolves.toBeUndefined();
  });

  it("throws if skill is already archived", async () => {
    const supabase = makeSupabase({ objectRow: makeSkillRow({ status: "archived" }) });
    await expect(archiveSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID))
      .rejects.toThrow("already archived");
  });

  it("throws if skill belongs to a different workspace", async () => {
    const supabase = makeSupabase({ objectRow: makeSkillRow({ workspace_id: OTHER_WORKSPACE_ID }) });
    await expect(archiveSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID))
      .rejects.toThrow("not found");
  });
});

describe("trashSkill", () => {
  it("trashes an active skill, leaving box_object_attachments intact", async () => {
    // Attachment rows are NOT touched by the lifecycle service — this is by design.
    // The supabase mock not expecting any attachment table call is the assertion.
    const supabase = makeSupabase({ objectRow: makeSkillRow() });
    await expect(trashSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID)).resolves.toBeUndefined();
    // Verify no attachment table was queried
    const fromCalls = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(fromCalls).not.toContain("box_object_attachments");
  });

  it("throws if skill is already trashed", async () => {
    const supabase = makeSupabase({ objectRow: makeSkillRow({ status: "trashed" }) });
    await expect(trashSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID))
      .rejects.toThrow("already trashed");
  });
});

describe("unarchiveSkill / restoreSkill", () => {
  it("unarchives an archived skill", async () => {
    const supabase = makeSupabase({ objectRow: makeSkillRow({ status: "archived" }) });
    await expect(unarchiveSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID)).resolves.toBeUndefined();
  });

  it("restores a trashed skill", async () => {
    const supabase = makeSupabase({ objectRow: makeSkillRow({ status: "trashed" }) });
    await expect(restoreSkill(supabase, USER_ID, WORKSPACE_ID, SKILL_ID)).resolves.toBeUndefined();
  });
});

// ─── Agent lifecycle ──────────────────────────────────────────────────────────

describe("archiveAgent", () => {
  it("archives a reusable workspace agent", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow() });
    await expect(archiveAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID)).resolves.toBeUndefined();
  });

  it("throws if agent is already archived", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow({ status: "archived" }) });
    await expect(archiveAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID))
      .rejects.toThrow("already archived");
  });

  it("throws if agent is trashed", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow({ status: "trashed" }) });
    await expect(archiveAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID))
      .rejects.toThrow("Cannot archive a trashed agent");
  });

  it("throws if agent does not exist", async () => {
    const supabase = makeSupabase({ objectRow: null });
    await expect(archiveAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID))
      .rejects.toThrow("not found");
  });
});

describe("trashAgent", () => {
  it("trashes a reusable agent, leaving attachments intact by design", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow() });
    await expect(trashAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID)).resolves.toBeUndefined();
    const fromCalls = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(fromCalls).not.toContain("box_object_attachments");
  });
});

describe("unarchiveAgent / restoreAgent", () => {
  it("unarchives an archived agent", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow({ status: "archived" }) });
    await expect(unarchiveAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID)).resolves.toBeUndefined();
  });

  it("restores a trashed agent", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow({ status: "trashed" }) });
    await expect(restoreAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID)).resolves.toBeUndefined();
  });

  it("throws if agent is not archived when unarchiving", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow({ status: "active" }) });
    await expect(unarchiveAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID))
      .rejects.toThrow("not archived");
  });

  it("throws if agent is not trashed when restoring", async () => {
    const supabase = makeSupabase({ objectRow: makeAgentRow({ status: "active" }) });
    await expect(restoreAgent(supabase, USER_ID, WORKSPACE_ID, AGENT_ID))
      .rejects.toThrow("not trashed");
  });
});
