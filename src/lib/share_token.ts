import { createHmac } from "crypto";

const secret = () => {
  const s = process.env.SHARE_SECRET ?? "dev-share-secret-change-in-prod";
  return s;
};

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
