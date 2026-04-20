"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  createApiKey,
  listApiKeysForUser,
  revokeApiKey,
  type CreatedApiKey,
  type OperatorApiKeyPublic,
} from "@/server/services/operator_api_keys_service";

/**
 * Operator REST API key actions.
 *
 * Wrap the underlying service for the settings UI. Notably:
 *   - `createOperatorApiKeyAction` returns the raw key — the UI must
 *     show it ONCE then forget it; the server forgets it as soon as
 *     the response leaves this action.
 *   - `listOperatorApiKeysAction` returns the public-shape rows (no hash).
 *   - `revokeOperatorApiKeyAction` is idempotent — revoking twice is
 *     fine and returns `{ revoked: false }` on the second call.
 */

export type ApiKeyActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const SETTINGS_PATH = "/app/settings/operator_preferences";

// ─── List ───────────────────────────────────────────────────────────────────

export async function listOperatorApiKeysAction(): Promise<
  ApiKeyActionResult<OperatorApiKeyPublic[]>
> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const rows = await listApiKeysForUser(supabase, ctx.user.id);
    return { ok: true, data: rows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list API keys.",
    };
  }
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateOperatorApiKeyInput {
  name: string;
}

export async function createOperatorApiKeyAction(
  input: CreateOperatorApiKeyInput
): Promise<ApiKeyActionResult<CreatedApiKey>> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const created = await createApiKey(supabase, {
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      name: input.name,
    });
    try {
      revalidatePath(SETTINGS_PATH);
    } catch {
      /* see prompts_actions.ts */
    }
    return { ok: true, data: created };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create API key.",
    };
  }
}

// ─── Revoke ─────────────────────────────────────────────────────────────────

export async function revokeOperatorApiKeyAction(
  id: string
): Promise<ApiKeyActionResult<{ revoked: boolean }>> {
  try {
    if (!id) return { ok: false, error: "id is required." };
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const revoked = await revokeApiKey(supabase, id, ctx.user.id);
    try {
      revalidatePath(SETTINGS_PATH);
    } catch {
      /* see prompts_actions.ts */
    }
    return { ok: true, data: { revoked } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to revoke API key.",
    };
  }
}
