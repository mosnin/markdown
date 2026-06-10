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

/**
 * Share tokens encode a per-resource `share_version` alongside the id so a
 * link can be revoked. The HMAC is computed over `id:version`; bumping the
 * row's share_version changes the signature, so every link issued against the
 * old version stops verifying against the live row (the share page requires
 * `row.share_version === token.version`).
 *
 * verify*Token is still pure — it parses the payload and checks the HMAC. It
 * does NOT read the database; the version comparison happens on the page after
 * the row is fetched.
 */
export interface VerifiedShareToken {
  id: string;
  version: number;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseVersion(raw: string): number | null {
  // Versions are positive integers. Reject anything non-canonical so a
  // forged payload can't sneak past via NaN / leading-zero ambiguity.
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  return Number(raw);
}

export function signBoxToken(boxId: string, version: number): string {
  const payload = `box:${boxId}:${version}`;
  const mac = createHmac("sha256", secret()).update(payload).digest("hex");
  // token = base64url(box:boxId:version:mac)
  return Buffer.from(`${payload}:${mac}`).toString("base64url");
}

export function verifyBoxToken(token: string): VerifiedShareToken | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    // The `box:` prefix keeps the box and note payload spaces disjoint, so a
    // note token can never verify as a box token (and vice versa).
    if (!decoded.startsWith("box:")) return null;
    const stripped = decoded.slice("box:".length);
    // Split from the right: the mac is the last field, version the one before
    // it, and everything ahead is the (colon-free) box id.
    const lastColon = stripped.lastIndexOf(":");
    if (lastColon === -1) return null;
    const mac = stripped.slice(lastColon + 1);
    const idAndVersion = stripped.slice(0, lastColon);
    const versionColon = idAndVersion.lastIndexOf(":");
    if (versionColon === -1) return null;
    const boxId = idAndVersion.slice(0, versionColon);
    const version = parseVersion(idAndVersion.slice(versionColon + 1));
    if (version === null) return null;
    const expected = createHmac("sha256", secret())
      .update(`box:${idAndVersion}`)
      .digest("hex");
    if (!timingSafeEqual(mac, expected)) return null;
    return { id: boxId, version };
  } catch {
    return null;
  }
}

// Note token: uses a distinct prefix so tokens can't be mixed up
// (a box share token should not accidentally verify as a note token and vice versa).

export function signNoteToken(noteId: string, version: number): string {
  const payload = `note:${noteId}:${version}`;
  const mac = createHmac("sha256", secret()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${mac}`).toString("base64url");
}

export function verifyNoteToken(token: string): VerifiedShareToken | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    if (!decoded.startsWith("note:")) return null;
    const stripped = decoded.slice("note:".length);
    const lastColon = stripped.lastIndexOf(":");
    if (lastColon === -1) return null;
    const mac = stripped.slice(lastColon + 1);
    const idAndVersion = stripped.slice(0, lastColon);
    const versionColon = idAndVersion.lastIndexOf(":");
    if (versionColon === -1) return null;
    const noteId = idAndVersion.slice(0, versionColon);
    const version = parseVersion(idAndVersion.slice(versionColon + 1));
    if (version === null) return null;
    // The signed payload includes the `note:` prefix so it can't collide
    // with a box token's payload space.
    const expected = createHmac("sha256", secret())
      .update(`note:${idAndVersion}`)
      .digest("hex");
    if (!timingSafeEqual(mac, expected)) return null;
    return { id: noteId, version };
  } catch {
    return null;
  }
}
