"use server";

import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createClient } from "@/lib/supabase/server";
import type { EntityType } from "@/server/domain/types/entity";

export interface EntitySearchHit {
  id: string;
  name: string;
  entity_type: EntityType;
  mention_count: number;
}

export type SearchResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function searchEntitiesAction(
  query: string,
  limit: number = 10
): Promise<SearchResult<EntitySearchHit[]>> {
  try {
    const ctx = await requireAuthenticatedUser();
    const supabase = await createClient();

    const trimmed = query.trim();
    if (!trimmed) return { ok: true, data: [] };

    // Case-insensitive prefix/infix match, ordered by mention_count
    const { data, error } = await supabase
      .from("entities")
      .select("id, name, entity_type, mention_count")
      .eq("workspace_id", ctx.workspace.id)
      .ilike("name", `%${trimmed}%`)
      .order("mention_count", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { ok: true, data: (data ?? []) as EntitySearchHit[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
