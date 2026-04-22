/**
 * Entity merge service.
 *
 * Merges one entity (the "source") into another (the "target"). All
 * mentions and edges pointing at the source are re-pointed to the
 * target, mention_counts are summed, descriptions are combined (the
 * target keeps its description unless empty), and the source row is
 * deleted.
 *
 * Not transactional across all ops — if a step fails partway, the
 * caller retries. Edge re-pointing can create duplicate edges
 * (unique constraint violation); those are silently ignored.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntityById } from "@/server/repositories/entity_repository";

export interface MergeResult {
  mentionsMoved: number;
  edgesMoved: number;
  edgesDropped: number;
  mergedMentionCount: number;
}

export async function mergeEntities(
  supabase: SupabaseClient,
  workspaceId: string,
  sourceId: string,
  targetId: string
): Promise<MergeResult> {
  if (sourceId === targetId) throw new Error("Cannot merge an entity into itself");

  // Ownership check: both entities must belong to the workspace
  const [source, target] = await Promise.all([
    getEntityById(supabase, sourceId),
    getEntityById(supabase, targetId),
  ]);
  if (!source || !target) throw new Error("Entity not found");
  if (source.workspace_id !== workspaceId || target.workspace_id !== workspaceId) {
    throw new Error("Entities belong to different workspaces");
  }

  // Step 1: re-point mentions
  const { data: movedMentions, error: mErr } = await supabase
    .from("entity_mentions")
    .update({ entity_id: targetId })
    .eq("entity_id", sourceId)
    .select("id");
  if (mErr) throw mErr;
  const mentionsMoved = movedMentions?.length ?? 0;

  // Step 2: re-point edges where source is the source_entity_id.
  // Some of these may create duplicates (same source/target/type/note);
  // catch unique-constraint violations and drop them.
  let edgesMoved = 0;
  let edgesDropped = 0;

  const { data: srcEdges } = await supabase
    .from("entity_edges")
    .select("*")
    .eq("source_entity_id", sourceId);

  for (const e of srcEdges ?? []) {
    // Drop self-loops that would result from the merge
    if (e.target_entity_id === targetId) {
      await supabase.from("entity_edges").delete().eq("id", e.id);
      edgesDropped += 1;
      continue;
    }
    const { error } = await supabase
      .from("entity_edges")
      .update({ source_entity_id: targetId })
      .eq("id", e.id);
    if (error) {
      if (error.code === "23505") {
        await supabase.from("entity_edges").delete().eq("id", e.id);
        edgesDropped += 1;
      } else throw error;
    } else edgesMoved += 1;
  }

  // Step 3: same for target_entity_id
  const { data: tgtEdges } = await supabase
    .from("entity_edges")
    .select("*")
    .eq("target_entity_id", sourceId);

  for (const e of tgtEdges ?? []) {
    if (e.source_entity_id === targetId) {
      await supabase.from("entity_edges").delete().eq("id", e.id);
      edgesDropped += 1;
      continue;
    }
    const { error } = await supabase
      .from("entity_edges")
      .update({ target_entity_id: targetId })
      .eq("id", e.id);
    if (error) {
      if (error.code === "23505") {
        await supabase.from("entity_edges").delete().eq("id", e.id);
        edgesDropped += 1;
      } else throw error;
    } else edgesMoved += 1;
  }

  // Step 4: sum mention_counts + pick better description
  const combinedDescription = target.description?.trim() || source.description?.trim() || null;
  const mergedCount = (target.mention_count ?? 0) + (source.mention_count ?? 0);

  await supabase
    .from("entities")
    .update({
      mention_count: mergedCount,
      description: combinedDescription,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", targetId);

  // Step 5: delete source entity (cascades any dangling mentions — shouldn't be any)
  const { error: delErr } = await supabase.from("entities").delete().eq("id", sourceId);
  if (delErr) throw delErr;

  return { mentionsMoved, edgesMoved, edgesDropped, mergedMentionCount: mergedCount };
}
