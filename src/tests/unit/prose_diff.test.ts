import { describe, it, expect } from "vitest";
import { computeDiff, type DiffPart } from "@/components/product/prose_diff";

describe("computeDiff", () => {
  it("returns all-green when before is null (new content)", () => {
    const { parts, isLineFallback } = computeDiff(null, "hello world");
    expect(isLineFallback).toBe(false);
    expect(parts).toHaveLength(1);
    expect(parts[0].added).toBe(true);
    expect(parts[0].removed).toBe(false);
    expect(parts[0].value).toBe("hello world");
  });

  it("returns all-red when after is null (deleted content)", () => {
    const { parts, isLineFallback } = computeDiff("hello world", null);
    expect(isLineFallback).toBe(false);
    expect(parts).toHaveLength(1);
    expect(parts[0].added).toBe(false);
    expect(parts[0].removed).toBe(true);
    expect(parts[0].value).toBe("hello world");
  });

  it("returns empty array when both are null", () => {
    const { parts } = computeDiff(null, null);
    expect(parts).toHaveLength(0);
  });

  it("marks added text correctly", () => {
    const { parts } = computeDiff("hello world", "hello brave world");
    const addedParts = parts.filter((p) => p.added);
    expect(addedParts.length).toBeGreaterThanOrEqual(1);
    const addedText = addedParts.map((p) => p.value).join("");
    expect(addedText).toContain("brave");
  });

  it("marks removed text correctly", () => {
    const { parts } = computeDiff("hello brave world", "hello world");
    const removedParts = parts.filter((p) => p.removed);
    expect(removedParts.length).toBeGreaterThanOrEqual(1);
    const removedText = removedParts.map((p) => p.value).join("");
    expect(removedText).toContain("brave");
  });

  it("unchanged text is neither added nor removed", () => {
    const { parts } = computeDiff("hello world", "hello world");
    expect(parts.every((p) => !p.added && !p.removed)).toBe(true);
    expect(parts.map((p) => p.value).join("")).toBe("hello world");
  });

  it("handles multi-paragraph changes", () => {
    const before = "First paragraph.\n\nSecond paragraph.";
    const after = "First paragraph.\n\nUpdated second paragraph.";
    const { parts } = computeDiff(before, after);
    const addedParts = parts.filter((p) => p.added);
    const removedParts = parts.filter((p) => p.removed);
    expect(addedParts.length).toBeGreaterThanOrEqual(1);
    expect(removedParts.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to line-level diff for large content", () => {
    // Generate content > 50KB
    const bigBefore = "line A\n".repeat(5000); // ~35KB
    const bigAfter = "line B\n".repeat(5000); // ~35KB
    // combined > 50KB
    const { isLineFallback } = computeDiff(bigBefore, bigAfter);
    expect(isLineFallback).toBe(true);
  });

  it("does NOT fall back for small content", () => {
    const { isLineFallback } = computeDiff("small", "text");
    expect(isLineFallback).toBe(false);
  });

  it("preserves all content in diff parts", () => {
    const before = "The quick brown fox";
    const after = "The slow brown dog";
    const { parts } = computeDiff(before, after);
    // Reconstruct: removed + unchanged = before, added + unchanged = after
    const reconstructedBefore = parts
      .filter((p) => !p.added)
      .map((p) => p.value)
      .join("");
    const reconstructedAfter = parts
      .filter((p) => !p.removed)
      .map((p) => p.value)
      .join("");
    expect(reconstructedBefore).toBe(before);
    expect(reconstructedAfter).toBe(after);
  });
});
