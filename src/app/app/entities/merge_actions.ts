"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { mergeEntities, type MergeResult } from "@/server/services/entity_merge_service";
import { listEntitiesByWorkspace } from "@/server/repositories/entity_repository";
import type { Entity } from "@/server/domain/types/entity";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function mergeEntitiesAction(
  sourceId: string,
  targetId: string
): Promise<ActionResult<MergeResult>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const result = await mergeEntities(supabase, ctx.workspace.id, sourceId, targetId);
    revalidatePath("/app/graph");
    revalidatePath(`/app/entities/${targetId}`);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function listMergeCandidatesAction(
  excludeId: string
): Promise<ActionResult<Array<Pick<Entity, "id" | "name" | "entity_type" | "mention_count">>>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();
    const all = await listEntitiesByWorkspace(supabase, ctx.workspace.id, { limit: 200 });
    const filtered = all
      .filter((e) => e.id !== excludeId)
      .map((e) => ({ id: e.id, name: e.name, entity_type: e.entity_type, mention_count: e.mention_count }));
    return { ok: true, data: filtered };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
