import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/app/api/agent/_lib/auth", () => ({
  verifyAgentRequest: vi.fn(),
}));

import { POST, ssrfCheck } from "@/app/api/agent/tools/web_fetch/route";
import { verifyAgentRequest } from "@/app/api/agent/_lib/auth";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/agent/tools/web_fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const okCtx = {
  ok: true,
  ctx: {
    userId: "00000000-0000-0000-0000-000000000001",
    workspaceId: "11111111-1111-1111-1111-111111111111",
    branchId: "22222222-2222-2222-2222-222222222222",
    runId: "abcdef1234567890",
  },
};

describe("ssrfCheck", () => {
  it("rejects file:// URLs", () => {
    expect(ssrfCheck("file:///etc/passwd").ok).toBe(false);
  });
  it("rejects http://localhost", () => {
    expect(ssrfCheck("http://localhost/admin").ok).toBe(false);
  });
  it("rejects http://127.0.0.1", () => {
    expect(ssrfCheck("http://127.0.0.1:8080/").ok).toBe(false);
  });
  it("rejects ::1", () => {
    expect(ssrfCheck("http://[::1]/").ok).toBe(false);
  });
  it("rejects 169.254.169.254 (cloud metadata)", () => {
    expect(ssrfCheck("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });
  it("rejects 10.0.0.0/8", () => {
    expect(ssrfCheck("http://10.0.0.1/").ok).toBe(false);
  });
  it("rejects 192.168.0.0/16", () => {
    expect(ssrfCheck("http://192.168.1.1/").ok).toBe(false);
  });
  it("rejects 172.16.0.0/12", () => {
    expect(ssrfCheck("http://172.16.0.1/").ok).toBe(false);
    expect(ssrfCheck("http://172.31.255.1/").ok).toBe(false);
  });
  it("rejects ftp://example.com (non-http scheme)", () => {
    expect(ssrfCheck("ftp://example.com/").ok).toBe(false);
  });
  it("rejects malformed URLs", () => {
    expect(ssrfCheck("not a url").ok).toBe(false);
  });
  it("rejects .internal hosts", () => {
    expect(ssrfCheck("http://api.internal/").ok).toBe(false);
  });
  it("allows public hostnames", () => {
    expect(ssrfCheck("https://example.com/path").ok).toBe(true);
    expect(ssrfCheck("https://www.wikipedia.org/").ok).toBe(true);
  });
});

describe("POST /api/agent/tools/web_fetch", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("rejects invalid secret with 401", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "invalid_secret" },
    } as any);
    const res = await POST(makeRequest({ url: "https://example.com" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when feature disabled", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue({
      ok: false,
      failure: { kind: "feature_disabled" },
    } as any);
    const res = await POST(makeRequest({ url: "https://example.com" }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error_code).toBe("feature_disabled");
  });

  it("returns 400 when url is missing", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 forbidden_url for SSRF-blocked URLs", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    for (const url of [
      "file:///etc/passwd",
      "http://localhost/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
    ]) {
      const res = await POST(makeRequest({ url }));
      expect(res.status, `expected ${url} to be blocked`).toBe(400);
      const json = await res.json();
      expect(json.error_code).toBe("forbidden_url");
    }
  });

  it("returns 200 with stripped HTML on happy path", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    global.fetch = vi.fn(async () => {
      return new Response(
        "<html><head><title>x</title><script>bad()</script></head><body>Hello <b>world</b></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      );
    }) as unknown as typeof fetch;

    const res = await POST(makeRequest({ url: "https://example.com/page" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe(200);
    expect(json.data.text).not.toContain("<b>");
    expect(json.data.text).not.toContain("bad()");
    expect(json.data.text).toContain("Hello");
    expect(json.data.text).toContain("world");
    expect(json.data.truncated).toBe(false);
  });

  it("returns truncated=true when body exceeds 32 KB", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    const big = "a".repeat(64 * 1024);
    global.fetch = vi.fn(async () => {
      return new Response(big, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }) as unknown as typeof fetch;

    const res = await POST(makeRequest({ url: "https://example.com/big" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.truncated).toBe(true);
    expect(json.data.text.length).toBeLessThanOrEqual(32 * 1024);
  });

  it("returns 502 when fetch throws", async () => {
    vi.mocked(verifyAgentRequest).mockReturnValue(okCtx as any);
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await POST(makeRequest({ url: "https://example.com" }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error_code).toBe("fetch_failed");
  });
});
