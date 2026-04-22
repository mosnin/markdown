import { createHmac } from "crypto";

function getShareSecret(): string {
  const secret = process.env.SHARE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SHARE_SECRET environment variable is required in production. " +
        "Set it to a random 32+ character string."
      );
    }
    // Dev/test fallback — intentionally weak so it's obvious this isn't prod
    return "dev-share-secret-change-in-prod";
  }
  return secret;
}

const secret = getShareSecret;

export function signBoxToken(boxId: string): string {
  const mac = createHmac("sha256", secret()).update(boxId).digest("hex");
  // token = base64url(boxId:mac)
  return Buffer.from(`${boxId}:${mac}`).toString("base64url");
}

export function verifyBoxToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx === -1) return null;
    const boxId = decoded.slice(0, colonIdx);
    const mac = decoded.slice(colonIdx + 1);
    const expected = createHmac("sha256", secret()).update(boxId).digest("hex");
    // Timing-safe compare
    if (mac.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0 ? boxId : null;
  } catch {
    return null;
  }
}

// Note token: uses a distinct prefix so tokens can't be mixed up
// (a box share token should not accidentally verify as a note token and vice versa).

export function signNoteToken(noteId: string): string {
  const mac = createHmac("sha256", secret()).update(`note:${noteId}`).digest("hex");
  return Buffer.from(`note:${noteId}:${mac}`).toString("base64url");
}

export function verifyNoteToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    if (!decoded.startsWith("note:")) return null;
    const stripped = decoded.slice("note:".length);
    const colonIdx = stripped.indexOf(":");
    if (colonIdx === -1) return null;
    const noteId = stripped.slice(0, colonIdx);
    const mac = stripped.slice(colonIdx + 1);
    const expected = createHmac("sha256", secret()).update(`note:${noteId}`).digest("hex");
    if (mac.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0 ? noteId : null;
  } catch {
    return null;
  }
}
