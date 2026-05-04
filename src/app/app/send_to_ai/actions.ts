"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCanonicalBaseUrl } from "@/lib/canonical_url";
import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import {
  issuePullToken,
  revokePullToken,
  type PullTokenObjectType,
} from "@/server/services/pull_token_service";

/**
 * Server actions for the **Send to AI** popover.
 *
 * Agent A's slice — Agents B/C/D layer UI on top of these. The contract:
 *
 *   - issuePullTokenAction validates that the calling user owns / has
 *     access to the targeted object, mints a token via the service,
 *     and returns the raw token + the redeem URL. Caller must surface
 *     the token to the user once and never persist it.
 *   - revokePullTokenAction revokes a token by id; idempotent.
 *
 * v1 only supports `objectType: "note"`. Other types throw a clear
 * error so the UI can render an inline message.
 */

// Names match the stub Agent B was wiring against.
export interface IssuePullTokenInput {
  objectType: PullTokenObjectType;
  objectId: string;
  ttlSeconds: number;
  writeCapable: boolean;
  slidingWindowSeconds?: number;
}

export interface IssuePullTokenResult {
  token: string;
  expiresAt: string;
  writeCapable: boolean;
  pullUrl: string;
}

/**
 * Issue a new pull-token. Throws on unauthenticated calls and on
 * unsupported object types.
 */
export async function issuePullTokenAction(
  input: IssuePullTokenInput
): Promise<IssuePullTokenResult> {
  const ctx = await requireAuthenticatedUser();
  const { user, workspace } = ctx;

  if (input.objectType !== "note") {
    // v1 supports notes only — keep the error message stable so the UI
    // can render it verbatim.
    throw new Error(
      `Send to AI: object_type "${input.objectType}" is not yet supported. Only notes can be shared in v1.`
    );
  }

  const admin = createAdminClient();

  // ── Scope check: confirm the targeted note belongs to the caller's
  // workspace. We hit the box because notes don't carry workspace_id
  // directly.
  const note = await getNoteById(admin, input.objectId);
  if (!note || note.status === "trashed") {
    throw new Error("Send to AI: note not found");
  }

  const box = await getBoxById(admin, note.box_id);
  if (!box || box.workspace_id !== workspace.id) {
    throw new Error("Send to AI: note does not belong to your workspace");
  }

  // ── Issue the token.
  const { token, summary } = await issuePullToken(admin, {
    workspaceId: workspace.id,
    userId: user.id,
    objectType: "note",
    objectId: note.id,
    ttlSeconds: input.ttlSeconds,
    writeCapable: input.writeCapable,
    slidingWindowSeconds: input.slidingWindowSeconds,
  });

  const pullUrl = `${getCanonicalBaseUrl()}/p/n/${token}`;

  // Settings tabs and audit pages may want to refresh on issue.
  revalidatePath("/app/settings");
  revalidatePath("/app/send_to_ai");

  return {
    token,
    expiresAt: summary.expiresAt,
    writeCapable: summary.writeCapable,
    pullUrl,
  };
}

/**
 * Revoke a pull-token by id. Idempotent — safe to call on an already-
 * revoked token. Always scoped to the calling user.
 */
export async function revokePullTokenAction(tokenId: string): Promise<void> {
  const ctx = await requireAuthenticatedUser();
  const admin = createAdminClient();
  await revokePullToken(admin, tokenId, ctx.user.id);
  revalidatePath("/app/settings");
  revalidatePath("/app/send_to_ai");
}
