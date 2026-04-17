import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/server/services/change_set_service", async () => ({ openChangeSet: vi.fn().mockResolvedValue({ id: "cs-atomic", status: "open" }), commitChangeSet: vi.fn().mockResolvedValue(undefined), abortChangeSet: vi.fn().mockResolvedValue(undefined), recordChangeSetItem: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/services/box_branch_metadata_service", () => ({ promoteBoxOverlays: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/services/folder_branch_service", () => ({ promoteFolderOverrides: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/services/placement_branch_service", () => ({ promotePlacementOverrides: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/services/pending_op_service", () => ({ listPendingOps: vi.fn().mockResolvedValue([]), applyPendingOp: vi.fn() }));
vi.mock("@/server/services/branch_promotion_gate_service", () => ({ runGates: vi.fn().mockResolvedValue({ allPassed: true, runs: [] }), GatePromotionError: class GatePromotionError extends Error {} }));
import { promoteBranch } from "@/server/services/branch_service";
import * as changeSet from "@/server/services/change_set_service";
const WS = "ws-a", UID = "u-a", BID = "b-a";
function makeMock(opts: { casMatches?: number; forceError?: boolean } = {}) {
  let casLeft = opts.casMatches ?? 1;
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  function fromFn(table: string) {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    b.select = () => { const s: Record<string, unknown> = {}; s.eq = (c: string, v: unknown) => { filters[c] = v; return s; }; s.maybeSingle = async () => { if (table === "draft_branches") return { data: { id: BID, workspace_id: WS, name: "a", status: "open" }, error: null }; if (table === "notes") { if (opts.forceError) throw new Error("forced"); return { data: { id: "n1", current_version_id: "vm", title: "t", markdown_content: "m", content_bytes: 1, summary: null }, error: null }; } if (table === "note_versions") return { data: { id: "vb", title: "t2", markdown_content: "m2", content_bytes: 2 }, error: null }; return { data: null, error: null }; }; s.single = s.maybeSingle; s.then = async (r: (v: { data: unknown; error: null }) => void) => { if (table === "branch_heads") r({ data: [{ id: "h1", branch_id: BID, object_type: "note", object_id: "n1", version_id: "vb" }], error: null }); else r({ data: [], error: null }); }; return s; };
    b.update = (patch: Record<string, unknown>) => { const cf: Record<string, unknown> = {}; const u: Record<string, unknown> = {}; u.eq = (c: string, v: unknown) => { cf[c] = v; return u; }; u.select = () => { if (table === "draft_branches" && cf.status === "open" && patch.status === "promoting") { updates.push({ table, patch, filters: { ...cf } }); const m = casLeft > 0 ? 1 : 0; casLeft--; return Promise.resolve({ data: m ? [{ id: BID }] : [], error: null }); } updates.push({ table, patch, filters: { ...cf } }); return Promise.resolve({ data: [{ id: "x" }], error: null }); }; u.then = async (r: (v: { error: null }) => void) => { updates.push({ table, patch, filters: { ...cf } }); r({ error: null }); }; return u; };
    b.delete = () => { const d: Record<string, unknown> = {}; d.eq = () => d; d.then = async (r: (v: { error: null }) => void) => r({ error: null }); return d; };
    b.insert = () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) });
    b.upsert = () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) });
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    return b;
  }
  return { client: { from: fromFn } as never, updates };
}
beforeEach(() => vi.clearAllMocks());
describe("promoteBranch — concurrent-promote guard", () => {
  it("rejects second concurrent promote", async () => { const { client } = makeMock({ casMatches: 0 }); await expect(promoteBranch(client, WS, UID, BID)).rejects.toThrow(/already in progress|not open/i); });
  it("lets winner proceed and transitions promoting->promoted", async () => { const { client, updates } = makeMock({ casMatches: 1 }); const r = await promoteBranch(client, WS, UID, BID); expect(r.branchId).toBe(BID); expect(updates.filter(u => u.table === "draft_branches" && u.patch.status === "promoting")).toHaveLength(1); expect(updates.filter(u => u.table === "draft_branches" && u.patch.status === "promoted" && u.filters.status === "promoting")).toHaveLength(1); });
});
describe("promoteBranch — abort on failure", () => {
  it("aborts change set and resets status on error", async () => { const { client, updates } = makeMock({ casMatches: 1, forceError: true }); await expect(promoteBranch(client, WS, UID, BID)).rejects.toThrow(); expect(vi.mocked(changeSet.abortChangeSet)).toHaveBeenCalledWith(expect.anything(), "cs-atomic", expect.any(String)); expect(updates.filter(u => u.table === "draft_branches" && u.patch.status === "open" && u.filters.status === "promoting")).toHaveLength(1); expect(updates.filter(u => u.patch.status === "promoted")).toHaveLength(0); });
});
