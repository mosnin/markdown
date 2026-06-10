import { createHmac, timingSafeEqual } from "crypto";

/**
 * Consent-request integrity signature.
 *
 * The OAuth consent screen lets a user *narrow* (never broaden) the set of
 * boxes a connector asked for. That narrow-only rule was previously enforced
 * only in the client form — a crafted POST to `approveAuthorizeAction` could
 * grant boxes the connector never requested. To enforce it server-side, the
 * authorize page signs the connector's originally-requested box set and the
 * consent form posts the signature back; the action verifies it and rejects
 * any granted box scope outside the requested set.
 *
 * The HMAC is domain-separated and bound to the client_id so a signature can
 * never be confused with a share token (both read SHARE_SECRET) or replayed
 * for a different client.
 */

const DOMAIN = "oauth-consent-boxes:v1:";

function secret(): string {
  const s = process.env.SHARE_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SHARE_SECRET is required in production (OAuth consent integrity)."
      );
    }
    // Dev/test fallback — intentionally weak so it's obvious this isn't prod.
    return "dev-share-secret-change-in-prod";
  }
  return s;
}

/**
 * Canonical string for the connector's requested box set: "*" means the
 * connector asked for workspace-wide access (the user may grant any reachable
 * box); otherwise the sorted box ids joined by ",".
 */
export function canonicalConnectorBoxes(boxIds: string[] | null): string {
  if (!boxIds || boxIds.length === 0) return "*";
  return [...boxIds].sort().join(",");
}

/** HMAC binding (clientId, canonical requested-box set). */
export function signConsentBoxes(clientId: string, canonical: string): string {
  return createHmac("sha256", secret())
    .update(`${DOMAIN}${clientId}:${canonical}`)
    .digest("hex");
}

export function verifyConsentBoxes(
  clientId: string,
  canonical: string,
  sig: string
): boolean {
  const expected = signConsentBoxes(clientId, canonical);
  if (typeof sig !== "string" || sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
