import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Saved Workspace-Operator prompts.
 *
 * A small CRUD service over `public.workspace_operator_prompts`. Each
 * prompt is private to the user that authored it (RLS enforces this);
 * the (workspace_id, user_id, name) UNIQUE constraint means a user can
 * only have one "Weekly summary" pin in a given workspace at a time.
 *
 * Validation lives here as well as in the DB CHECK constraints — the
 * latter are belt-and-suspenders for direct DB writes; the former
 * gives the UI a friendly error string before round-tripping.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OperatorPromptRow {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

export interface ListOperatorPromptsArgs {
  workspaceId: string;
  userId: string;
}

export interface CreateOperatorPromptArgs {
  workspaceId: string;
  userId: string;
  name: string;
  prompt: string;
}

export interface UpdateOperatorPromptPatch {
  name?: string;
  prompt?: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const NAME_MIN = 1;
const NAME_MAX = 80;
const PROMPT_MIN = 1;
const PROMPT_MAX = 4000;

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN) throw new Error("Prompt name is required");
  if (trimmed.length > NAME_MAX) {
    throw new Error(`Prompt name must be ${NAME_MAX} characters or fewer`);
  }
  return trimmed;
}

function validatePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length < PROMPT_MIN) throw new Error("Prompt body is required");
  if (trimmed.length > PROMPT_MAX) {
    throw new Error(`Prompt body must be ${PROMPT_MAX} characters or fewer`);
  }
  return trimmed;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

/**
 * List the saved prompts for a (workspace, user) pair, newest-updated
 * first. RLS already restricts to the calling user's rows; the explicit
 * user_id filter is defensive — if a future caller passes the admin
 * client, we still scope to the right user.
 */
export async function listOperatorPrompts(
  supabase: SupabaseClient,
  args: ListOperatorPromptsArgs
): Promise<OperatorPromptRow[]> {
  const { data, error } = await supabase
    .from("workspace_operator_prompts")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list operator prompts: ${error.message}`);
  }
  return (data ?? []) as OperatorPromptRow[];
}

/**
 * Create a new saved prompt. Throws on (name, workspace, user) conflict —
 * the caller surfaces that as a 409 / friendly "Name already used" message.
 */
export async function createOperatorPrompt(
  supabase: SupabaseClient,
  args: CreateOperatorPromptArgs
): Promise<OperatorPromptRow> {
  const name = validateName(args.name);
  const prompt = validatePrompt(args.prompt);

  const { data, error } = await supabase
    .from("workspace_operator_prompts")
    .insert({
      workspace_id: args.workspaceId,
      user_id: args.userId,
      name,
      prompt,
    })
    .select("*")
    .single();

  if (error || !data) {
    // Postgres unique-violation code is 23505. The PostgREST client
    // surfaces it on `error.code`. We rethrow with a friendlier message
    // so callers don't have to know SQLSTATEs.
    if (error?.code === "23505") {
      throw new Error(
        "A prompt with that name already exists in this workspace."
      );
    }
    throw new Error(
      `Failed to create operator prompt: ${error?.message ?? "unknown"}`
    );
  }
  return data as OperatorPromptRow;
}

/**
 * Patch a prompt row. Only the supplied fields are written. The
 * `userId` arg is an explicit ownership check — even though RLS would
 * filter the UPDATE, the maybeSingle() lets us return a clean
 * "not found" rather than the silent no-op a raw RLS update would.
 */
export async function updateOperatorPrompt(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  patch: UpdateOperatorPromptPatch
): Promise<OperatorPromptRow> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = validateName(patch.name);
  if (patch.prompt !== undefined) update.prompt = validatePrompt(patch.prompt);

  if (Object.keys(update).length === 0) {
    // Nothing to write — return the current row so the UI can reflect
    // server state without a separate fetch.
    const existing = await getOperatorPrompt(supabase, id, userId);
    if (!existing) throw new Error("Operator prompt not found");
    return existing;
  }

  const { data, error } = await supabase
    .from("workspace_operator_prompts")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "A prompt with that name already exists in this workspace."
      );
    }
    throw new Error(
      `Failed to update operator prompt: ${error.message ?? "unknown"}`
    );
  }
  if (!data) throw new Error("Operator prompt not found");
  return data as OperatorPromptRow;
}

/**
 * Delete a prompt. Returns true when a row was actually removed, false
 * when no row matched — the caller can decide whether that's a 404 or
 * an idempotent success.
 */
export async function deleteOperatorPrompt(
  supabase: SupabaseClient,
  id: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("workspace_operator_prompts")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(
      `Failed to delete operator prompt: ${error.message ?? "unknown"}`
    );
  }
  return (data ?? []).length > 0;
}

/**
 * Single-row read scoped to the caller. Returns null on miss — callers
 * never need to distinguish "RLS hid it" from "doesn't exist".
 */
export async function getOperatorPrompt(
  supabase: SupabaseClient,
  id: string,
  userId: string
): Promise<OperatorPromptRow | null> {
  const { data, error } = await supabase
    .from("workspace_operator_prompts")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load operator prompt: ${error.message}`);
  }
  return (data ?? null) as OperatorPromptRow | null;
}
