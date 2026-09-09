import { describe, it, expect } from "vitest";

/**
 * Unit tests for agent event redaction.
 *
 * Agent event payloads are the most secret-dense data this product holds: a
 * PostToolUse hook can carry a .env file, an `export AWS_SECRET=…` command
 * line, or a stack trace with a database URL in it. These tests pin the
 * invariants that make storing that data defensible:
 *
 *   1. Credential-shaped values are replaced wherever they appear.
 *   2. Sensitive KEYS are replaced regardless of what their value looks like.
 *   3. Structure survives — readers and the brief assembler still see the
 *      same keys and array shapes.
 *   4. It never throws, and it terminates on hostile input (deep nesting,
 *      cycles, huge strings).
 */

import {
  redactPayload,
  redactString,
  redactFilePaths,
} from "@/server/services/session_event_redaction";

describe("redactString", () => {
  it("redacts bearer tokens", () => {
    expect(redactString("Authorization: Bearer abc123.def-456")).toBe(
      "Authorization: Bearer <redacted>"
    );
  });

  it("redacts provider API keys by shape", () => {
    expect(redactString("key sk-ant-abcdefghijklmnopqrstuv")).toContain(
      "<anthropic-key>"
    );
    expect(redactString("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe(
      "<github-token>"
    );
    expect(redactString("AKIAIOSFODNN7EXAMPLE")).toBe("<aws-access-key-id>");
  });

  it("redacts this product's own relay and connection keys", () => {
    const relayKey = `pgr_v1_${"a".repeat(64)}`;
    // Relay keys share the csk hex shape; either label is fine, the secret is not.
    expect(redactString(`token=${relayKey}`)).not.toContain("a".repeat(64));
    expect(redactString(`csk_v1_${"b".repeat(64)}`)).toBe("csk_v1_<redacted>");
  });

  it("keeps the scheme and host of a connection string but drops credentials", () => {
    expect(redactString("postgres://user:hunter2@db.example.com:5432/app")).toBe(
      "postgres://<redacted>@db.example.com:5432/app"
    );
  });

  it("redacts sensitive shell assignments but leaves ordinary ones alone", () => {
    expect(redactString("export API_KEY=abc123")).toBe("export API_KEY=<redacted>");
    expect(redactString("export NODE_ENV=production")).toBe(
      "export NODE_ENV=production"
    );
  });

  it("redacts private key blocks whole", () => {
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\nAQEA\n-----END RSA PRIVATE KEY-----";
    expect(redactString(key)).toBe("<private-key>");
  });

  it("truncates strings past the cap rather than storing them whole", () => {
    const huge = "x".repeat(20_000);
    const out = redactString(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain("truncated");
  });

  it("leaves ordinary prose untouched", () => {
    const prose = "Refactored the auth guard so viewers cannot reach /app/admin.";
    expect(redactString(prose)).toBe(prose);
  });
});

describe("redactPayload", () => {
  it("replaces values under sensitive keys regardless of content", () => {
    const out = redactPayload({
      password: "hunter2",
      api_key: "not-obviously-a-key",
      authorization: "anything",
      note: "keep me",
    });
    expect(out).toEqual({
      password: "<redacted>",
      api_key: "<redacted>",
      authorization: "<redacted>",
      note: "keep me",
    });
  });

  it("preserves structure while scrubbing nested values", () => {
    const out = redactPayload({
      command: "curl -H 'Bearer abc123def' https://api.example.com",
      env: { HOME: "/home/dev", GITHUB_TOKEN: "ghp_aaaaaaaaaaaaaaaaaaaaaaaa" },
      args: ["--verbose", "sk-abcdefghijklmnopqrstuvwx"],
    });

    expect(out).not.toBeNull();
    expect(out!.env).toEqual({ HOME: "/home/dev", GITHUB_TOKEN: "<redacted>" });
    expect(Array.isArray(out!.args)).toBe(true);
    expect((out!.args as string[])[0]).toBe("--verbose");
    expect((out!.args as string[])[1]).toBe("<api-key>");
    expect(String(out!.command)).toContain("Bearer <redacted>");
  });

  it("returns null for an absent payload so we store SQL NULL", () => {
    expect(redactPayload(null)).toBeNull();
    expect(redactPayload(undefined)).toBeNull();
  });

  it("wraps scalar payloads so the column shape stays predictable", () => {
    expect(redactPayload("just a string")).toEqual({ value: "just a string" });
    expect(redactPayload(42)).toEqual({ value: 42 });
  });

  it("terminates on deeply nested input instead of recursing forever", () => {
    let deep: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 200; i += 1) deep = { nested: deep };

    const out = redactPayload(deep);
    expect(out).not.toBeNull();
    // Past the depth cap the subtree is dropped rather than descended.
    expect(JSON.stringify(out)).toContain("<redacted>");
  });

  it("survives a cyclic object without throwing", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;

    // The depth cap breaks the cycle; the contract is only that we return
    // something storable and do not throw.
    expect(() => redactPayload(cyclic)).not.toThrow();
    expect(redactPayload(cyclic)).not.toBeNull();
  });
});

describe("redactFilePaths", () => {
  it("strips the user-identifying prefix from absolute paths", () => {
    expect(redactFilePaths(["/home/alice/code/app/src/index.ts"])).toEqual([
      "~/code/app/src/index.ts",
    ]);
    expect(redactFilePaths(["/Users/bob/repo/main.go"])).toEqual(["~/repo/main.go"]);
    expect(redactFilePaths(["C:\\Users\\carol\\proj\\a.cs"])).toEqual([
      "~\\proj\\a.cs",
    ]);
  });

  it("leaves relative paths alone", () => {
    expect(redactFilePaths(["src/server/index.ts"])).toEqual([
      "src/server/index.ts",
    ]);
  });
});
