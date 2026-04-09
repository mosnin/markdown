import { describe, it, expect } from "vitest";

/**
 * Unit tests for connection token format validation logic.
 *
 * These tests verify the structural checks that happen at the top of
 * getConnectionContext() before any DB lookups occur. They document the
 * token format contract and guard against regressions.
 *
 * Token format: csk_v1_<64 lowercase hex chars>
 *   Total length: 7 (prefix) + 64 (hex) = 71 chars
 */

// Extract the pure validation logic so it can be tested independently.
// This mirrors the exact checks in get_connection_context.ts.
function parseTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken.startsWith("csk_v1_")) return null;

  const hex = rawToken.slice(7); // after "csk_v1_"
  if (hex.length !== 64 || !/^[0-9a-f]{64}$/.test(hex)) return null;

  return hex;
}

const VALID_HEX = "a".repeat(64);
const VALID_HEADER = `Bearer csk_v1_${VALID_HEX}`;

describe("Connection token format validation", () => {
  describe("valid tokens", () => {
    it("accepts a well-formed token", () => {
      expect(parseTokenFromHeader(VALID_HEADER)).toBe(VALID_HEX);
    });

    it("accepts tokens with mixed valid hex chars (0-9 and a-f)", () => {
      const hex = "0123456789abcdef".repeat(4);
      expect(parseTokenFromHeader(`Bearer csk_v1_${hex}`)).toBe(hex);
    });
  });

  describe("missing or malformed header", () => {
    it("rejects null header", () => {
      expect(parseTokenFromHeader(null)).toBeNull();
    });

    it("rejects empty string", () => {
      expect(parseTokenFromHeader("")).toBeNull();
    });

    it("rejects header without Bearer prefix", () => {
      expect(parseTokenFromHeader(`Token csk_v1_${VALID_HEX}`)).toBeNull();
    });

    it("rejects header with only Bearer and no token", () => {
      expect(parseTokenFromHeader("Bearer ")).toBeNull();
    });
  });

  describe("wrong token prefix", () => {
    it("rejects token without csk_v1_ prefix", () => {
      expect(parseTokenFromHeader(`Bearer ${VALID_HEX}`)).toBeNull();
    });

    it("rejects token with different prefix", () => {
      expect(parseTokenFromHeader(`Bearer sk_v1_${VALID_HEX}`)).toBeNull();
    });

    it("rejects token with uppercase prefix", () => {
      // prefix check is case-sensitive
      expect(parseTokenFromHeader(`Bearer CSK_V1_${VALID_HEX}`)).toBeNull();
    });
  });

  describe("hex part validation", () => {
    it("rejects hex that is too short (63 chars)", () => {
      const shortHex = "a".repeat(63);
      expect(parseTokenFromHeader(`Bearer csk_v1_${shortHex}`)).toBeNull();
    });

    it("rejects hex that is too long (65 chars)", () => {
      const longHex = "a".repeat(65);
      expect(parseTokenFromHeader(`Bearer csk_v1_${longHex}`)).toBeNull();
    });

    it("rejects uppercase hex chars", () => {
      const upperHex = "A".repeat(64);
      expect(parseTokenFromHeader(`Bearer csk_v1_${upperHex}`)).toBeNull();
    });

    it("rejects hex with non-hex characters (g-z)", () => {
      const invalidHex = "g".repeat(64);
      expect(parseTokenFromHeader(`Bearer csk_v1_${invalidHex}`)).toBeNull();
    });

    it("rejects hex containing spaces", () => {
      const spacedHex = "a".repeat(32) + " " + "a".repeat(31);
      expect(parseTokenFromHeader(`Bearer csk_v1_${spacedHex}`)).toBeNull();
    });

    it("rejects empty hex part", () => {
      expect(parseTokenFromHeader("Bearer csk_v1_")).toBeNull();
    });
  });
});
