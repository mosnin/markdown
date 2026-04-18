import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Integration tests for the email digest cron route.
 *
 * Verifies:
 *   - Missing / wrong `x-cron-secret` header -> 401
 *   - Correct header -> 200 and the body is forwarded to sendDigestBatch
 *   - Unknown cadence in body falls back to "daily"
 *   - Missing body also falls back to "daily"
 */

// Mock both the admin Supabase factory and the service function so the
// route can be exercised in isolation without a real Supabase connection.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ __mock: "admin" }),
}));

vi.mock("@/server/services/email_digest_service", () => ({
  sendDigestBatch: vi.fn(async () => ({ sent: 3, skipped: 1, failed: 0 })),
}));

import { POST } from "@/app/api/internal/email_digest/route";
import { sendDigestBatch } from "@/server/services/email_digest_service";
import { NextRequest } from "next/server";

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "s3cr3t";
  vi.mocked(sendDigestBatch).mockClear();
  vi.mocked(sendDigestBatch).mockResolvedValue({
    sent: 3,
    skipped: 1,
    failed: 0,
  });
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

function buildRequest(opts: {
  secret?: string | null;
  body?: string;
} = {}): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.secret !== null && opts.secret !== undefined) {
    headers["x-cron-secret"] = opts.secret;
  }
  return new NextRequest("http://test.local/api/internal/email_digest", {
    method: "POST",
    headers,
    body: opts.body ?? "",
  });
}

describe("POST /api/internal/email_digest", () => {
  it("returns 401 when the x-cron-secret header is missing", async () => {
    const req = buildRequest({ secret: null });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Unauthorized");
    expect(sendDigestBatch).not.toHaveBeenCalled();
  });

  it("returns 401 when the x-cron-secret header does not match", async () => {
    const req = buildRequest({ secret: "wrong" });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(sendDigestBatch).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const req = buildRequest({ secret: "anything" });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(sendDigestBatch).not.toHaveBeenCalled();
  });

  it("returns 200 with the batch result when secret matches", async () => {
    const req = buildRequest({
      secret: "s3cr3t",
      body: JSON.stringify({ cadence: "weekly" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sent: number;
      skipped: number;
      failed: number;
    };
    expect(body).toEqual({ sent: 3, skipped: 1, failed: 0 });

    expect(sendDigestBatch).toHaveBeenCalledTimes(1);
    const [, cadence] = vi.mocked(sendDigestBatch).mock.calls[0]!;
    expect(cadence).toBe("weekly");
  });

  it("defaults to daily cadence when body is missing", async () => {
    const req = buildRequest({ secret: "s3cr3t" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const [, cadence] = vi.mocked(sendDigestBatch).mock.calls[0]!;
    expect(cadence).toBe("daily");
  });

  it("defaults to daily cadence when body has an unknown value", async () => {
    const req = buildRequest({
      secret: "s3cr3t",
      body: JSON.stringify({ cadence: "monthly" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const [, cadence] = vi.mocked(sendDigestBatch).mock.calls[0]!;
    expect(cadence).toBe("daily");
  });
});
