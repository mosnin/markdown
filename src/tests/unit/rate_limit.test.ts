import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, purgeExpiredEntries } from "@/lib/api/rate_limit";

// Each test uses a unique key prefix to avoid cross-test contamination
let testId = 0;
function uniqueKey(prefix = "test") {
  return `${prefix}_${++testId}_${Date.now()}`;
}

describe("Rate limiter", () => {
  describe("checkRateLimit", () => {
    it("allows the first request", () => {
      const result = checkRateLimit(uniqueKey(), 5, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.retryAfter).toBe(0);
    });

    it("allows requests up to the limit", () => {
      const key = uniqueKey();
      const limit = 3;
      for (let i = 0; i < limit; i++) {
        const r = checkRateLimit(key, limit, 60);
        expect(r.allowed).toBe(true);
      }
    });

    it("blocks the request after the limit is exceeded", () => {
      const key = uniqueKey();
      const limit = 3;
      for (let i = 0; i < limit; i++) {
        checkRateLimit(key, limit, 60);
      }
      const r = checkRateLimit(key, limit, 60);
      expect(r.allowed).toBe(false);
      expect(r.remaining).toBe(0);
      expect(r.retryAfter).toBeGreaterThan(0);
    });

    it("decrements remaining correctly", () => {
      const key = uniqueKey();
      const limit = 5;
      const r1 = checkRateLimit(key, limit, 60);
      expect(r1.remaining).toBe(4);
      const r2 = checkRateLimit(key, limit, 60);
      expect(r2.remaining).toBe(3);
    });

    it("uses a separate counter per key", () => {
      const key1 = uniqueKey("ka");
      const key2 = uniqueKey("kb");
      const limit = 2;
      checkRateLimit(key1, limit, 60);
      checkRateLimit(key1, limit, 60);
      // key1 should be exhausted, key2 should be fresh
      const r1 = checkRateLimit(key1, limit, 60);
      const r2 = checkRateLimit(key2, limit, 60);
      expect(r1.allowed).toBe(false);
      expect(r2.allowed).toBe(true);
    });

    it("resets the window after the window duration", async () => {
      const key = uniqueKey();
      const limit = 1;
      const windowSecs = 0.05; // 50ms for test speed
      checkRateLimit(key, limit, windowSecs); // use up the limit
      const blocked = checkRateLimit(key, limit, windowSecs);
      expect(blocked.allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 60)); // wait for window to expire

      const reset = checkRateLimit(key, limit, windowSecs);
      expect(reset.allowed).toBe(true);
    });
  });

  describe("purgeExpiredEntries", () => {
    it("removes entries that have exceeded the window age", async () => {
      const key = uniqueKey("purge");
      checkRateLimit(key, 10, 0.01); // 10ms window
      await new Promise((r) => setTimeout(r, 20));
      purgeExpiredEntries(0.01);
      // After purge, the entry is gone — next request should be treated as fresh
      const r = checkRateLimit(key, 10, 60);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(9);
    });
  });
});
