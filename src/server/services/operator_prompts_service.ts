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
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ReorderOperatorPromptsItem {
  id: string;
  sort_order: number;
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
 * List the saved prompts for a (workspace, user) pair, honouring the
 * user-managed `sort_order` (ascending — smaller = higher up in the UI).
 * `updated_at DESC` is kept as a stable tiebreak so legacy rows that
 * share the default seed and never-moved prompts retain the
 * newest-updated-first ordering the UI shipped with.
 *
 * RLS already restricts to the calling user's rows; the explicit user_id
 * filter is defensive — if a future caller passes the admin client, we
 * still scope to the right user.
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
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list operator prompts: ${error.message}`);
  }
  return (data ?? []) as OperatorPromptRow[];
}

/**
 * Create a new saved prompt. Throws on (name, workspace, user) conflict —
 * the caller surfaces that as a 409 / friendly "Name already used" message.
 *
 * New rows default to `sort_order = (max existing + 1)` within the
 * (workspace, user) partition, so a freshly-saved prompt lands at the END
 * of the list. Users who want the new row at the top can promote it with
 * the Move-Up buttons; this default avoids surprising reshuffles of an
 * established list when someone saves a one-off prompt.
 */
export async function createOperatorPrompt(
  supabase: SupabaseClient,
  args: CreateOperatorPromptArgs
): Promise<OperatorPromptRow> {
  const name = validateName(args.name);
  const prompt = validatePrompt(args.prompt);

  // Compute the next sort_order. Read every row in the partition (there
  // are only ever a handful) ordered desc; the first element's
  // sort_order + 1 is the next slot. An empty partition (user's first
  // prompt) yields 0.
  //
  // We avoid `.limit(1).maybeSingle()` here deliberately — it's less
  // portable across our fake-supabase test doubles, and the cardinality
  // is small enough that reading N ints is a non-issue.
  const { data: maxRows, error: maxErr } = (await supabase
    .from("workspace_operator_prompts")
    .select("sort_order")
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId)
    .order("sort_order", { ascending: false })) as {
    data: Array<{ sort_order: number }> | null;
    error: { message?: string } | null;
  };

  if (maxErr) {
    throw new Error(
      `Failed to compute next sort_order: ${maxErr.message ?? "unknown"}`
    );
  }
  const topRow = (maxRows ?? [])[0];
  const nextSortOrder =
    (typeof topRow?.sort_order === "number" ? topRow.sort_order : -1) + 1;

  const { data, error } = await supabase
    .from("workspace_operator_prompts")
    .insert({
      workspace_id: args.workspaceId,
      user_id: args.userId,
      name,
      prompt,
      sort_order: nextSortOrder,
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
 * Apply a batch of (id, sort_order) updates to the caller's prompts.
 *
 * Contract:
 *   - every supplied id must belong to `userId` (ownership check up front
 *     via a single SELECT — cheaper than N per-row updates failing silently
 *     under RLS);
 *   - rows not mentioned in `items` are left untouched;
 *   - on success the caller receives the full post-reorder list for the
 *     (workspace, user) pair, so the UI can re-render without a round-trip.
 *
 * Implementation: we issue one UPDATE per item, scoped by (id, user_id).
 * Supabase's PostgREST client does not expose a single multi-row UPDATE
 * with per-row values, and a raw RPC feels like overkill for the small
 * N (single-digit prompt counts in practice). The updates are
 * sequential — postgres crash-safety across the batch is not required,
 * because a partial reorder still leaves every row with a valid
 * sort_order and the UI re-fetches on error.
 */
export async function reorderOperatorPrompts(
  supabase: SupabaseClient,
  userId: string,
  items: ReorderOperatorPromptsItem[]
): Promise<OperatorPromptRow[]> {
  if (items.length === 0) {
    throw new Error("No reorder items supplied.");
  }
  // Reject duplicate ids up front — catches client bugs that would
  // otherwise silently overwrite one of the updates.
  const ids = items.map((it) => it.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate id in reorder items.");
  }
  for (const item of items) {
    if (!item.id) throw new Error("Reorder item missing id.");
    if (!Number.isInteger(item.sort_order)) {
      throw new Error("sort_order must be an integer.");
    }
  }

  // Ownership check: fetch every requested id scoped to this user. If
  // the returned set is smaller than `ids`, one or more ids belong to
  // another user (or don't exist) — refuse the whole batch.
  const { data: owned, error: ownedErr } = await supabase
    .from("workspace_operator_prompts")
    .select("id, workspace_id")
    .in("id", ids)
    .eq("user_id", userId);

  if (ownedErr) {
    throw new Error(`Failed to verify prompt ownership: ${ownedErr.message}`);
  }
  const ownedRows = (owned ?? []) as Array<{
    id: string;
    workspace_id: string;
  }>;
  if (ownedRows.length !== ids.length) {
    throw new Error("One or more prompts do not belong to the current user.");
  }

  // All items must live in a single workspace — the UI only ever
  // reorders within one workspace at a time, and mixing workspaces
  // would be a correctness hazard (the returned list below is scoped to
  // exactly one workspace).
  const workspaceIds = new Set(ownedRows.map((r) => r.workspace_id));
  if (workspaceIds.size !== 1) {
    throw new Error("Reorder items must share a single workspace.");
  }
  const [workspaceId] = [...workspaceIds];

  // Apply the updates one at a time, scoped by (id, user_id). The
  // sequential loop keeps the fake-supabase test doubles simple and is
  // plenty fast for the handful of rows users typically curate.
  for (const item of items) {
    const { error } = await supabase
      .from("workspace_operator_prompts")
      .update({ sort_order: item.sort_order })
      .eq("id", item.id)
      .eq("user_id", userId);
    if (error) {
      throw new Error(
        `Failed to reorder prompt ${item.id}: ${error.message ?? "unknown"}`
      );
    }
  }

  return listOperatorPrompts(supabase, {
    workspaceId: workspaceId ?? "",
    userId,
  });
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
