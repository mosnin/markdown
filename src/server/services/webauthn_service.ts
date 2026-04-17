import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Configuration ───────────────────────────────────────────────────────────

const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Poggle";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? `https://${RP_ID}`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoredCredential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string; // base64-encoded bytea from Postgres
  counter: number;
  transports: string[] | null;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a base64 string (as returned by Supabase for `bytea`) into a Uint8Array. */
function base64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Convert a Uint8Array to standard base64 for storage in a `bytea` column. */
function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}

// ─── Challenge store ─────────────────────────────────────────────────────────

async function storeChallenge(
  supabase: SupabaseClient,
  userId: string | null,
  challenge: string,
  type: "registration" | "authentication",
): Promise<void> {
  const { error } = await supabase.from("webauthn_challenges").insert({
    user_id: userId,
    challenge,
    type,
  });
  if (error) throw new Error(`Failed to store challenge: ${error.message}`);
}

/**
 * Atomically fetch and delete the most recent unexpired challenge for a
 * given user + type. Throws if no valid challenge exists.
 */
async function consumeChallenge(
  supabase: SupabaseClient,
  userId: string | null,
  type: "registration" | "authentication",
): Promise<string> {
  const query = supabase
    .from("webauthn_challenges")
    .delete()
    .eq("type", type)
    .gt("expires_at", new Date().toISOString());

  if (userId) {
    query.eq("user_id", userId);
  } else {
    query.is("user_id", null);
  }

  const { data, error } = await query
    .select("challenge")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Challenge lookup failed: ${error.message}`);
  if (!data) throw new Error("Challenge not found or expired");
  return (data as { challenge: string }).challenge;
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Generate WebAuthn registration options for the given user.
 *
 * The returned JSON can be passed directly to `@simplewebauthn/browser`'s
 * `startRegistration()`. The challenge is persisted server-side so it
 * can be verified in the subsequent call to `verifyAndStoreRegistration`.
 */
export async function generateRegistrationOpts(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string,
) {
  // Fetch existing credentials to populate excludeCredentials.
  const existing = await listCredentials(supabase, userId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: userEmail,
    userDisplayName: userEmail,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
  });

  await storeChallenge(supabase, userId, options.challenge, "registration");
  return options;
}

/**
 * Verify a registration response from the browser, persist the new
 * credential, and return the credential row ID.
 */
export async function verifyAndStoreRegistration(
  supabase: SupabaseClient,
  userId: string,
  response: RegistrationResponseJSON,
  deviceName?: string,
): Promise<{ credentialRowId: string }> {
  const expectedChallenge = await consumeChallenge(
    supabase,
    userId,
    "registration",
  );

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Registration verification failed");
  }

  const { credential } = verification.registrationInfo;

  const { data, error } = await supabase
    .from("webauthn_credentials")
    .insert({
      user_id: userId,
      credential_id: credential.id,
      public_key: uint8ArrayToBase64(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      device_name: deviceName ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to store credential: ${error.message}`);
  return { credentialRowId: (data as { id: string }).id };
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Generate WebAuthn authentication options. Uses a discoverable-credential
 * flow (no userId required) so any registered passkey can be used at sign-in.
 */
export async function generateAuthenticationOpts(
  supabase: SupabaseClient,
  userId?: string,
) {
  let allowCredentials:
    | { id: string; transports?: AuthenticatorTransportFuture[] }[]
    | undefined;

  if (userId) {
    const creds = await listCredentials(supabase, userId);
    allowCredentials = creds.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: "preferred",
  });

  await storeChallenge(
    supabase,
    userId ?? null,
    options.challenge,
    "authentication",
  );

  return options;
}

/**
 * Verify an authentication response and update the credential counter.
 * Returns the user_id associated with the credential so the caller can
 * create a session.
 */
export async function verifyAuthenticationAndGetUser(
  supabase: SupabaseClient,
  response: AuthenticationResponseJSON,
  userId?: string,
): Promise<{ userId: string; credentialId: string }> {
  // Look up the credential by its Base64URL credential ID.
  const { data: credRow, error: credErr } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", response.id)
    .maybeSingle();

  if (credErr) throw new Error(`Credential lookup failed: ${credErr.message}`);
  if (!credRow) throw new Error("Credential not found");

  const stored = credRow as StoredCredential;

  // Consume the challenge. For discoverable flows we first try by stored
  // user_id, then fall back to null-user challenges.
  let expectedChallenge: string;
  if (userId) {
    expectedChallenge = await consumeChallenge(
      supabase,
      userId,
      "authentication",
    );
  } else {
    try {
      expectedChallenge = await consumeChallenge(
        supabase,
        stored.user_id,
        "authentication",
      );
    } catch {
      // Fall back to null-user challenge (discoverable flow).
      expectedChallenge = await consumeChallenge(
        supabase,
        null,
        "authentication",
      );
    }
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: stored.credential_id,
      publicKey: base64ToUint8Array(stored.public_key),
      counter: stored.counter,
      transports: (stored.transports ?? []) as AuthenticatorTransportFuture[],
    },
    requireUserVerification: false,
  });

  if (!verification.verified) {
    throw new Error("Authentication verification failed");
  }

  // Update counter and last_used_at.
  await supabase
    .from("webauthn_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("credential_id", stored.credential_id);

  return { userId: stored.user_id, credentialId: stored.credential_id };
}

// ─── Credential management ───────────────────────────────────────────────────

/** List all passkey credentials for a given user (for the settings page). */
export async function listCredentials(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoredCredential[]> {
  const { data, error } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list credentials: ${error.message}`);
  return (data ?? []) as StoredCredential[];
}

/** Delete a passkey credential. Verifies ownership via user_id. */
export async function deleteCredential(
  supabase: SupabaseClient,
  credentialRowId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("webauthn_credentials")
    .delete()
    .eq("id", credentialRowId)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to delete credential: ${error.message}`);
}
