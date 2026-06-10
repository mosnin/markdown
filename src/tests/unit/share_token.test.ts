import { describe, it, expect } from "vitest";
import {
  signBoxToken,
  verifyBoxToken,
  signNoteToken,
  verifyNoteToken,
} from "@/lib/share_token";

/**
 * Unit tests for the versioned share-token scheme.
 *
 * Tokens encode `id:version` (notes are additionally prefixed with `note:`)
 * and are signed with an HMAC. verify*Token is pure — it parses + verifies
 * the signature and returns `{ id, version }`. The DB-backed revocation check
 * (row.share_version === token.version) lives on the share page, not here.
 */

const BOX_ID = "11111111-1111-1111-1111-111111111111";
const NOTE_ID = "22222222-2222-2222-2222-222222222222";

describe("box share tokens", () => {
  it("round-trips id and version", () => {
    const token = signBoxToken(BOX_ID, 1);
    expect(verifyBoxToken(token)).toEqual({ id: BOX_ID, version: 1 });
  });

  it("preserves a multi-digit version", () => {
    const token = signBoxToken(BOX_ID, 42);
    expect(verifyBoxToken(token)).toEqual({ id: BOX_ID, version: 42 });
  });

  it("produces a different token for a different version (revocation)", () => {
    const v1 = signBoxToken(BOX_ID, 1);
    const v2 = signBoxToken(BOX_ID, 2);
    expect(v1).not.toEqual(v2);
    // A v1 token still verifies structurally, but reports version 1 — the
    // page compares that against the live row's bumped share_version.
    expect(verifyBoxToken(v1)).toEqual({ id: BOX_ID, version: 1 });
    expect(verifyBoxToken(v2)).toEqual({ id: BOX_ID, version: 2 });
  });

  it("rejects a tampered token", () => {
    const token = signBoxToken(BOX_ID, 1);
    const tampered = Buffer.from(
      Buffer.from(token, "base64url").toString("utf8").replace(/:1:/, ":2:")
    ).toString("base64url");
    expect(verifyBoxToken(tampered)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyBoxToken("not-a-token")).toBeNull();
    expect(verifyBoxToken("")).toBeNull();
  });

  it("does not verify a note token as a box token", () => {
    const noteToken = signNoteToken(NOTE_ID, 1);
    expect(verifyBoxToken(noteToken)).toBeNull();
  });
});

describe("note share tokens", () => {
  it("round-trips id and version", () => {
    const token = signNoteToken(NOTE_ID, 1);
    expect(verifyNoteToken(token)).toEqual({ id: NOTE_ID, version: 1 });
  });

  it("produces a different token for a different version (revocation)", () => {
    const v1 = signNoteToken(NOTE_ID, 1);
    const v2 = signNoteToken(NOTE_ID, 2);
    expect(v1).not.toEqual(v2);
    expect(verifyNoteToken(v1)).toEqual({ id: NOTE_ID, version: 1 });
    expect(verifyNoteToken(v2)).toEqual({ id: NOTE_ID, version: 2 });
  });

  it("rejects a tampered token", () => {
    const token = signNoteToken(NOTE_ID, 1);
    const tampered = Buffer.from(
      Buffer.from(token, "base64url").toString("utf8").replace(/:1:/, ":2:")
    ).toString("base64url");
    expect(verifyNoteToken(tampered)).toBeNull();
  });

  it("does not verify a box token as a note token", () => {
    const boxToken = signBoxToken(BOX_ID, 1);
    expect(verifyNoteToken(boxToken)).toBeNull();
  });

  it("rejects a non-canonical version (leading zero)", () => {
    // Forge a payload with a leading-zero version; the HMAC won't match and
    // even if it did, parseVersion rejects the format.
    const forged = Buffer.from(`note:${NOTE_ID}:01:deadbeef`).toString("base64url");
    expect(verifyNoteToken(forged)).toBeNull();
  });
});
