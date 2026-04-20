"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRequestContext } from "@/server/auth/get_request_context";
import {
  listOperatorPrompts,
  createOperatorPrompt,
  updateOperatorPrompt,
  deleteOperatorPrompt,
  getOperatorPrompt,
  type OperatorPromptRow,
  type UpdateOperatorPromptPatch,
} from "@/server/services/operator_prompts_service";

/**
 * Saved-prompts CRUD actions used by the prompts manager UI.
 *
 * Every action resolves the request context, scopes the call to the
 * current (workspace, user) pair, and returns a discriminated `{ ok, ... }`
 * result. Mutations call `revalidatePath('/app/workspace_operator/prompts')`
 * so the server-rendered list re-fetches after the dialog closes.
 */

export type PromptsActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const PROMPTS_PATH = "/app/workspace_operator/prompts";

// ─── List ───────────────────────────────────────────────────────────────────

export async function listOperatorPromptsAction(): Promise<
  PromptsActionResult<OperatorPromptRow[]>
> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const rows = await listOperatorPrompts(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
    });
    return { ok: true, data: rows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list prompts.",
    };
  }
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateOperatorPromptInput {
  name: string;
  prompt: string;
}

export async function createOperatorPromptAction(
  input: CreateOperatorPromptInput
): Promise<PromptsActionResult<OperatorPromptRow>> {
  try {
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user || !ctx.workspace) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const row = await createOperatorPrompt(supabase, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      name: input.name,
      prompt: input.prompt,
    });
    try {
      revalidatePath(PROMPTS_PATH);
    } catch {
      // revalidatePath throws outside a request context (e.g. tests);
      // ignore so callers don't have to mock next/cache.
    }
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save prompt.",
    };
  }
}

// ─── Update ─────────────────────────────────────────────────────────────────

export interface UpdateOperatorPromptInput {
  id: string;
  patch: UpdateOperatorPromptPatch;
}

export async function updateOperatorPromptAction(
  input: UpdateOperatorPromptInput
): Promise<PromptsActionResult<OperatorPromptRow>> {
  try {
    if (!input.id) return { ok: false, error: "id is required." };
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const row = await updateOperatorPrompt(
      supabase,
      input.id,
      ctx.user.id,
      input.patch
    );
    try {
      revalidatePath(PROMPTS_PATH);
    } catch {
      /* see createOperatorPromptAction */
    }
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update prompt.",
    };
  }
}

// ─── Delete ─────────────────────────────────────────────────────────────────

export async function deleteOperatorPromptAction(
  id: string
): Promise<PromptsActionResult<{ deleted: boolean }>> {
  try {
    if (!id) return { ok: false, error: "id is required." };
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const removed = await deleteOperatorPrompt(supabase, id, ctx.user.id);
    try {
      revalidatePath(PROMPTS_PATH);
    } catch {
      /* see createOperatorPromptAction */
    }
    return { ok: true, data: { deleted: removed } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete prompt.",
    };
  }
}

// ─── Get one ────────────────────────────────────────────────────────────────

export async function getOperatorPromptAction(
  id: string
): Promise<PromptsActionResult<OperatorPromptRow | null>> {
  try {
    if (!id) return { ok: false, error: "id is required." };
    const ctx = await getRequestContext();
    if (!ctx.isAuthenticated || !ctx.user) {
      return { ok: false, error: "Unauthenticated." };
    }
    const supabase = await createClient();
    const row = await getOperatorPrompt(supabase, id, ctx.user.id);
    return { ok: true, data: row };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load prompt.",
    };
  }
}
