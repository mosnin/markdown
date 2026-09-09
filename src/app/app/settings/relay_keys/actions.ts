"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdminRoleResult } from "@/server/auth/require_role";
import {
  createRelayKey,
  listRelayKeys,
  revokeRelayKey,
  rotateRelayKey,
  type RelayKeySummary,
} from "@/server/services/relay_key_service";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const SETTINGS_PATH = "/app/settings/relay_keys";

/**
 * Server actions for relay key management.
 *
 * Admin-only. A relay key can append to a workspace's session log from any
 * machine on the internet, so minting one is an administrative act even though
 * the person pasting it into a laptop may not be an admin.
 *
 * The raw secret crosses this boundary exactly once, in the `create` and
 * `rotate` responses. It is never stored in a form of which it can be read back
 * — the database holds only a prefix and a sha256 — so a user who loses it
 * rotates rather than recovers.
 */

export async function listRelayKeysAction(): Promise<
  ActionResult<RelayKeySummary[]>
> {
  const auth = await requireAdminRoleResult();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const supabase = await createClient();
    const keys = await listRelayKeys(supabase, auth.ctx.workspace.id);
    return { ok: true, data: keys };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list relay keys",
    };
  }
}

export async function createRelayKeyAction(input: {
  name: string;
  description?: string;
}): Promise<ActionResult<{ token: string; key: RelayKeySummary }>> {
  const auth = await requireAdminRoleResult();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const supabase = await createClient();
    const result = await createRelayKey(
      supabase,
      auth.ctx.workspace.id,
      auth.ctx.user.id,
      { name: input.name, description: input.description ?? null }
    );
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create relay key",
    };
  }
}

export async function rotateRelayKeyAction(
  connectionId: string
): Promise<ActionResult<{ token: string; token_prefix: string }>> {
  const auth = await requireAdminRoleResult();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const supabase = await createClient();
    const result = await rotateRelayKey(
      supabase,
      auth.ctx.workspace.id,
      connectionId,
      auth.ctx.user.id
    );
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to rotate relay key",
    };
  }
}

export async function revokeRelayKeyAction(
  connectionId: string
): Promise<ActionResult> {
  const auth = await requireAdminRoleResult();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const supabase = await createClient();
    await revokeRelayKey(
      supabase,
      auth.ctx.workspace.id,
      connectionId,
      auth.ctx.user.id
    );
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to revoke relay key",
    };
  }
}
