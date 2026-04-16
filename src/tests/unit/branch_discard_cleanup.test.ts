import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ delete: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/require_role", () => ({ requireWriteRoleResult: vi.fn() }));
vi.mock("@/server/auth/require_authenticated_user", () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock("@/server/auth/get_request_context", () => ({ ACTIVE_BRANCH_COOKIE: "active_branch_id" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/repositories/audit_event_repository", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/services/pending_op_service", () => ({ dropAllPendingOpsForBranch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/services/box_branch_metadata_service", () => ({ dropAllBoxOverlaysForBranch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/services/folder_branch_service", () => ({ dropAllFolderOverridesForBranch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/services/placement_branch_service", () => ({ dropAllPlacementOverridesForBranch: vi.fn().mockResolvedValue(undefined) }));
import { discardBranchAction } from "@/app/app/branches/actions";
import { requireWriteRoleResult } from "@/server/auth/require_role";
import { createClient } from "@/lib/supabase/server";
const WS = "ws-d", UID = "u-d", BID = "b-d";
beforeEach(() => vi.clearAllMocks());
function makeMock() {
  const deletes: Array<{ table: string; filters: Record<string, unknown> }> = [];
  function fromFn(table: string) { const b: Record<string, unknown> = {}; b.select = () => ({ eq: () => ({ maybeSingle: async () => table === "draft_branches" ? { data: { workspace_id: WS, status: "open", name: "d" }, error: null } : { data: null, error: null } }) }); b.delete = () => { const f: Record<string, unknown> = {}; const d: Record<string, unknown> = {}; d.eq = (c: string, v: unknown) => { f[c] = v; return d; }; d.then = async (r: (v: { error: null }) => void) => { deletes.push({ table, filters: { ...f } }); r({ error: null }); }; return d; }; b.update = () => { const u: Record<string, unknown> = {}; u.eq = () => u; u.then = async (r: (v: { error: null }) => void) => r({ error: null }); return u; }; return b; }
  return { client: { from: fromFn }, deletes };
}
describe("discardBranchAction — cleanup", () => {
  it("deletes branch_heads along with every branch-scoped row", async () => {
    const { client, deletes } = makeMock();
    vi.mocked(requireWriteRoleResult).mockResolvedValue({ ok: true, ctx: { user: { id: UID }, workspace: { id: WS, name: "w" }, role: "owner", activeBranchId: null } } as never);
    vi.mocked(createClient).mockResolvedValue(client as never);
    const result = await discardBranchAction(BID);
    expect(result).toEqual({ ok: true, data: undefined });
    const tables = deletes.map(d => d.table);
    expect(tables).toContain("files");
    expect(tables).toContain("branch_heads");
    for (const d of deletes) expect(d.filters.branch_id).toBe(BID);
  });
});
