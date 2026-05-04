import { describe, it, expect } from "vitest";
import {
  redeemPullToken,
  PULL_TOKEN_PREFIX,
} from "@/server/services/pull_token_service";

/**
 * Pull-token expiry / revocation behaviours.
 *
 * The atomic enforcement lives in the `redeem_pull_token` SQL function
 * we ship in the migration. From the TypeScript side we can only
 * confirm that the service correctly translates the various RPC
 * outcomes (null row, expired-style empty, ISO-stamped happy path)
 * into RedeemResults.
 */

function makeRpcStub(
  impl: (
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>
) {
  return {
    rpc: (_name: string, args: Record<string, unknown>) => impl(args),
  } as unknown as Parameters<typeof redeemPullToken>[0];
}

describe("pull_token expiry / lifecycle", () => {
  const validToken = `${PULL_TOKEN_PREFIX}example-secret-payload`;

  it("returns null when the RPC indicates the token has expired (no rows)", async () => {
    const supabase = makeRpcStub(async () => ({ data: [], error: null }));
    const result = await redeemPullToken(supabase, validToken, null);
    expect(result).toBeNull();
  });

  it("returns null when the RPC indicates the token has been revoked (no rows)", async () => {
    const supabase = makeRpcStub(async () => ({ data: null, error: null }));
    const result = await redeemPullToken(supabase, validToken, "ua/1");
    expect(result).toBeNull();
  });

  it("returns null when the RPC reports an error", async () => {
    const supabase = makeRpcStub(async () => ({
      data: null,
      error: { message: "boom" },
    }));
    const result = await redeemPullToken(supabase, validToken, null);
    expect(result).toBeNull();
  });

  it("propagates the sliding new_expires_at from the RPC into the result", async () => {
    const newExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const supabase = makeRpcStub(async () => ({
      data: [
        {
          workspace_id: "ws-1",
          user_id: "user-1",
          object_type: "note",
          object_id: "note-1",
          write_capable: false,
          new_expires_at: newExpiresAt,
        },
      ],
      error: null,
    }));
    const result = await redeemPullToken(supabase, validToken, "ua/1");
    expect(result?.newExpiresAt).toBe(newExpiresAt);
    expect(result?.expiresInSeconds).toBeGreaterThan(0);
  });

  it("clamps expiresInSeconds to 0 when new_expires_at is in the past (e.g. clock skew)", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const supabase = makeRpcStub(async () => ({
      data: [
        {
          workspace_id: "ws-1",
          user_id: "user-1",
          object_type: "note",
          object_id: "note-1",
          write_capable: true,
          new_expires_at: past,
        },
      ],
      error: null,
    }));
    const result = await redeemPullToken(supabase, validToken, null);
    expect(result?.expiresInSeconds).toBe(0);
  });

  it("rejects raw strings missing the public prefix without hitting the RPC", async () => {
    let calls = 0;
    const supabase = makeRpcStub(async () => {
      calls++;
      return { data: [], error: null };
    });
    expect(await redeemPullToken(supabase, "csk_v1_xxx", null)).toBeNull();
    expect(await redeemPullToken(supabase, "", null)).toBeNull();
    expect(await redeemPullToken(supabase, "pgl_pull", null)).toBeNull();
    expect(calls).toBe(0);
  });
});
