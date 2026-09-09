import { describe, it, expect } from "vitest";

/**
 * Unit tests for cap inference.
 *
 * The reaping itself is mechanical; the REASON is where the risk is. Guessing
 * `completed` for a session that was cut off would tell the next agent the work
 * was finished when it was abandoned — the single most damaging thing this
 * product could get wrong, because it is a confident lie rather than a gap.
 *
 * So the matcher is tested from both sides: it must catch the real provider
 * wordings, and it must NOT fire on ordinary text that merely mentions limits.
 * Anything ambiguous is left as `unknown`, which the brief renders honestly.
 */

import { looksLikeCapMessage } from "@/server/services/session_reaper_service";

describe("looksLikeCapMessage", () => {
  it("recognises the wordings providers actually use", () => {
    const real = [
      "Usage limit reached. Your limit will reset at 3pm.",
      "You've hit your usage limit for this plan.",
      "You have reached your plan limit",
      "Rate limit exceeded, please retry later",
      "rate limit reached",
      "Error: quota exceeded for this billing period",
      "insufficient credits",
      "You are out of credits",
      "429 Too Many Requests — monthly quota reached",
    ];
    for (const message of real) {
      expect(looksLikeCapMessage(message), message).toBe(true);
    }
  });

  it("does not fire on ordinary text that mentions limits", () => {
    // Every one of these is plausible in a real transcript. Matching any of
    // them would mark a finished session as cut off.
    const innocent = [
      "Added a rate limit to the charges endpoint",
      "The test asserts we return 429 when the bucket is empty",
      "TODO: document the quota behaviour",
      "Refactored rateLimit() to take a window argument",
      "This function enforces a usage limit per workspace",
      "Reached the end of the file",
      "npm ERR! code ELIFECYCLE",
    ];
    for (const message of innocent) {
      expect(looksLikeCapMessage(message), message).toBe(false);
    }
  });

  it("handles absent input without throwing", () => {
    expect(looksLikeCapMessage(null)).toBe(false);
    expect(looksLikeCapMessage(undefined)).toBe(false);
    expect(looksLikeCapMessage("")).toBe(false);
  });
});
