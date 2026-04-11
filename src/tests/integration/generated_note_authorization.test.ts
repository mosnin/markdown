import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests: generated note authorization
 *
 * Validates the complete authorization chain enforced by `createGeneratedNote`:
 *
 *   1. Connection must have `generate_in_allowed_folders` permission mode.
 *   2. Target folder must exist and not be trashed.
 *   3. Folder's box_id must be in the connection's `allowedBoxIds` set.
 *   4. Folder must have `accepts_generated_notes = true`.
 *
 * These are service-level checks that happen INSIDE the service function,
 * independent of the route handler's own checks. Defense-in-depth ensures
 * that even if a route handler skips a check, the service enforces it.
 *
 * Tests also verify that the authorization checks happen in the right order
 * and produce distinct, legible error messages.
 */

vi.mock("@/server/repositories/note_repository");
vi.mock("@/server/repositories/folder_repository");
vi.mock("@/server/repositories/box_repository");
vi.mock("@/server/services/audit_service");

import { createGeneratedNote } from "@/server/services/generated_note_service";
import * as folderRepo from "@/server/repositories/folder_repository";
import * as boxRepo from "@/server/repositories/box_repository";
import * as auditService from "@/server/services/audit_service";
import { PERMISSION_MODE, type PermissionMode } from "@/server/domain/constants/connection_constants";

const WORKSPACE_ID = "ws-integration-002";
const BOX_ID = "box-002";
const FOLDER_ID = "folder-002";
const CONN_ID = "conn-002";

function makeCtx(permissionMode: PermissionMode = PERMISSION_MODE.GENERATE_IN_ALLOWED_FOLDERS) {
  return {
    connection: {
      id: CONN_ID,
      workspace_id: WORKSPACE_ID,
      name: "Test Agent",
      permission_mode: permissionMode,
      status: "active",
    },
    workspaceId: WORKSPACE_ID,
    allowedBoxIds: new Set([BOX_ID]),
    tokenId: "token-002",
  } as Parameters<typeof createGeneratedNote>[1];
}

function makeFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: FOLDER_ID,
    box_id: BOX_ID,
    status: "active",
    name: "Generated Notes",
    path_cache: "generated-notes",
    accepts_generated_notes: true,
    ...overrides,
  };
}

function makeBox() {
  return {
    id: BOX_ID,
    workspace_id: WORKSPACE_ID,
    status: "active",
    guide_note_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auditService.auditGeneratedNoteCreated).mockReturnValue(undefined as never);
});

describe("Generated note authorization — permission mode", () => {
  it("throws when connection has read_only permission", async () => {
    const ctx = makeCtx(PERMISSION_MODE.READ_ONLY);

    await expect(
      createGeneratedNote({} as never, ctx, { folder_id: FOLDER_ID })
    ).rejects.toThrow("generate_in_allowed_folders");
  });

  it("throws when connection has propose_writes permission", async () => {
    const ctx = makeCtx(PERMISSION_MODE.PROPOSE_WRITES);

    await expect(
      createGeneratedNote({} as never, ctx, { folder_id: FOLDER_ID })
    ).rejects.toThrow("generate_in_allowed_folders");
  });
});

describe("Generated note authorization — folder checks", () => {
  it("throws when folder does not exist", async () => {
    const ctx = makeCtx();
    vi.mocked(folderRepo.getFolderById).mockResolvedValue(null);

    await expect(
      createGeneratedNote({} as never, ctx, { folder_id: FOLDER_ID })
    ).rejects.toThrow("not found");
  });

  it("throws when folder is trashed", async () => {
    const ctx = makeCtx();
    vi.mocked(folderRepo.getFolderById).mockResolvedValue(
      makeFolder({ status: "trashed" }) as never
    );

    await expect(
      createGeneratedNote({} as never, ctx, { folder_id: FOLDER_ID })
    ).rejects.toThrow("not found");
  });
});

describe("Generated note authorization — box scope", () => {
  it("throws when folder belongs to a box not in allowedBoxIds", async () => {
    const ctx = makeCtx();
    ctx.allowedBoxIds = new Set(["other-box"]);  // FOLDER_ID's box is not allowed
    vi.mocked(folderRepo.getFolderById).mockResolvedValue(makeFolder() as never);

    await expect(
      createGeneratedNote({} as never, ctx, { folder_id: FOLDER_ID })
    ).rejects.toThrow("not in an allowed box");
  });
});

describe("Generated note authorization — accepts_generated_notes flag", () => {
  it("throws when folder has accepts_generated_notes = false", async () => {
    const ctx = makeCtx();
    vi.mocked(folderRepo.getFolderById).mockResolvedValue(
      makeFolder({ accepts_generated_notes: false }) as never
    );

    await expect(
      createGeneratedNote({} as never, ctx, { folder_id: FOLDER_ID })
    ).rejects.toThrow("accepts_generated_notes");
  });

  it("proceeds when all authorization checks pass", async () => {
    const ctx = makeCtx();
    vi.mocked(folderRepo.getFolderById).mockResolvedValue(makeFolder() as never);
    vi.mocked(boxRepo.getBoxById).mockResolvedValue(makeBox() as never);

    // Simulate the RPC creating the note
    const mockNote = {
      id: "new-generated-note",
      box_id: BOX_ID,
      folder_id: FOLDER_ID,
      title: "Test Agent 20260409_120000",
      is_generated: true,
      generated_by_connection_id: CONN_ID,
    };
    const mockVersion = { id: "version-new" };
    const mockRpc = vi.fn().mockResolvedValue({
      data: { note: mockNote, version: mockVersion },
      error: null,
    });
    // Mock supabase.from(...).select(...) chain for notePathExists
    const mockSupabase = {
      rpc: mockRpc,
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }), // no path collision
    } as never;

    const result = await createGeneratedNote(mockSupabase, ctx, {
      folder_id: FOLDER_ID,
      title: "Test Note",
    });

    expect(result.note.is_generated).toBe(true);
    expect(result.note.generated_by_connection_id).toBe(CONN_ID);
    expect(mockRpc).toHaveBeenCalledWith(
      "create_generated_note_with_version",
      expect.objectContaining({
        p_folder_id: FOLDER_ID,
        p_connection_id: CONN_ID,
      })
    );
  });
});
