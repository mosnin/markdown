"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import {
  listPullTokensForUser,
  revokePullToken,
  type PullTokenSummary,
} from "@/server/services/pull_token_service";
import { getNotesByIds } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import { getSkillsByIds } from "@/server/repositories/skill_repository";
import { getAgentsByIds } from "@/server/repositories/agent_repository";

/**
 * Server actions backing the **Pull links** tab on
 * `/app/settings/connected_apps`.
 *
 * Agent A owns the underlying service (`pull_token_service.ts`).
 * Agent C owns this thin action layer + the UI. Splitting the file
 * from `actions.ts` keeps the OAuth grants surface and the pull-link
 * surface independent — they share a page but no failure modes.
 */

export type PullActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface PullTokenRow extends PullTokenSummary {
  /** Display name resolved from the underlying object — falls back to ID. */
  objectName: string;
  /** True when the underlying object has been deleted / archived away. */
  objectDeleted: boolean;
}

/**
 * List every pull-token the caller has issued in their current
 * workspace, newest first. Resolves a human-readable object name per
 * row by batch-fetching from each underlying repository — keeps the
 * UI render call-site straightforward (one round-trip, one map).
 *
 * The supabase client is the user-bound RLS client, so a row simply
 * never appears if the caller can no longer see the workspace. We
 * still pass `userId` to the service so the service can apply its
 * own ownership filter (defense in depth — the service should never
 * return a token belonging to someone else even if RLS lapses).
 */
export async function listPullTokensAction(): Promise<
  PullActionResult<PullTokenRow[]>
> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const tokens = await listPullTokensForUser(
      supabase,
      ctx.workspace.id,
      ctx.user.id
    );

    if (tokens.length === 0) return { ok: true, data: [] };

    // Group object IDs by type so we hit each repo at most once.
    const noteIds = tokens.filter((t) => t.objectType === "note").map((t) => t.objectId);
    const boxIds = tokens.filter((t) => t.objectType === "box").map((t) => t.objectId);
    const skillIds = tokens.filter((t) => t.objectType === "skill").map((t) => t.objectId);
    const agentIds = tokens.filter((t) => t.objectType === "agent").map((t) => t.objectId);

    const [notes, skills, agents, boxes] = await Promise.all([
      noteIds.length ? getNotesByIds(supabase, noteIds) : Promise.resolve([]),
      skillIds.length ? getSkillsByIds(supabase, skillIds) : Promise.resolve([]),
      agentIds.length ? getAgentsByIds(supabase, agentIds) : Promise.resolve([]),
      boxIds.length
        ? Promise.all(boxIds.map((id) => getBoxById(supabase, id)))
        : Promise.resolve<Array<{ id: string; name: string } | null>>([]),
    ]);

    const noteMap = new Map(notes.map((n) => [n.id, n.title || "Untitled note"]));
    const boxMap = new Map(
      boxes.filter((b): b is { id: string; name: string } => !!b).map((b) => [b.id, b.name])
    );
    const skillMap = new Map(skills.map((s) => [s.id, s.name || "Untitled skill"]));
    const agentMap = new Map(agents.map((a) => [a.id, a.name || "Untitled agent"]));

    const rows: PullTokenRow[] = tokens.map((t) => {
      const map =
        t.objectType === "note"
          ? noteMap
          : t.objectType === "box"
            ? boxMap
            : t.objectType === "skill"
              ? skillMap
              : t.objectType === "agent"
                ? agentMap
                : null;
      const name = map?.get(t.objectId);
      return {
        ...t,
        objectName: name ?? t.objectId,
        objectDeleted: !name && t.objectType !== "bundle",
      };
    });

    return { ok: true, data: rows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list pull links",
    };
  }
}

/**
 * Revoke a pull-token the caller owns. The service enforces
 * ownership; we surface the error message to the UI on failure.
 *
 * No confirmation dialog at the call-site — revocation is reversible
 * (issue a new token), and the optimistic UI rolls back if this
 * action returns `ok: false`.
 */
export async function revokePullTokenAction(
  tokenId: string
): Promise<PullActionResult<{ revokedAt: string }>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    await revokePullToken(supabase, tokenId, ctx.user.id);

    revalidatePath("/app/settings/connected_apps");
    return { ok: true, data: { revokedAt: new Date().toISOString() } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Revoke failed",
    };
  }
}
