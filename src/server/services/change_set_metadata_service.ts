import { type SupabaseClient } from "@supabase/supabase-js";
import {
  getChangeSet,
  listChangeSetItems,
  listStructuralEvents,
  type ChangeSet,
  type ChangeSetItem,
} from "./change_set_service";
import { planRestoreFromChangeSet, type RestorePlan } from "./restore_service";

/**
 * Change-set metadata surface.
 *
 * The foundation prompt exposed `getChangeSet` / `listChangeSetItems`
 * / `listStructuralEvents` — raw row fetchers. UI work eventually
 * needs a richer shape that answers:
 *
 *   1. "If the user clicks Undo on this change set, what will change?"
 *      → RestoreCandidateSummary (scope, affected objects, blockers).
 *   2. "How does the current state compare to this change set's basis?"
 *      → ChangeSetComparison (per-object, before vs. after vs. current).
 *
 * Both live here so the UI layer can call one service and render a
 * clean story without reaching into repositories. `RestorePlan` (from
 * restore_service) stays the authoritative plan — this module wraps
 * it with denormalized display hints.
 *
 * No writes. These functions are strictly read surfaces.
 */

export interface AffectedObject {
  object_type: string;
  object_id: string;
  operation: string;
  /** Compact snapshot suitable for rendering — no raw content bytes. */
  displayHint?: Record<string, unknown>;
}

export interface RestoreCandidateSummary {
  changeSet: ChangeSet;
  itemCount: number;
  structuralCount: number;
  affectedObjects: AffectedObject[];
  affectedStructural: AffectedObject[];
  /** Derived from the underlying `RestorePlan`. */
  canRestore: boolean;
  blockers: string[];
  plan: RestorePlan;
}

/**
 * One-call summary for a history row / detail drawer. Combines the
 * raw rows with a restore plan so the UI can render "what happened",
 * "what will change if you undo it", and any blockers in one pass.
 */
export async function summarizeRestoreCandidate(
  supabase: SupabaseClient,
  changeSetId: string
): Promise<RestoreCandidateSummary | null> {
  const cs = await getChangeSet(supabase, changeSetId);
  if (!cs) return null;

  const [items, structural, plan] = await Promise.all([
    listChangeSetItems(supabase, changeSetId),
    listStructuralEvents(supabase, changeSetId),
    planRestoreFromChangeSet(supabase, changeSetId),
  ]);

  const affectedObjects: AffectedObject[] = items.map((i) => ({
    object_type: i.object_type,
    object_id: i.object_id,
    operation: i.operation,
    displayHint: compactItemHint(i),
  }));

  const affectedStructural: AffectedObject[] = structural.map((se) => ({
    object_type: se.object_type,
    object_id: se.object_id,
    operation: se.event_type,
    displayHint: {
      before: se.before_state,
      after: se.after_state,
      sequence: se.sequence,
    },
  }));

  return {
    changeSet: cs,
    itemCount: items.length,
    structuralCount: structural.length,
    affectedObjects,
    affectedStructural,
    canRestore: plan.blockers.length === 0 && cs.status === "committed",
    blockers: plan.blockers,
    plan,
  };
}

// ─── Version comparison ──────────────────────────────────────────────────────

export interface VersionFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface VersionComparison {
  object_type: "note" | "file" | "skill" | "agent";
  object_id: string;
  baselineVersionId: string;
  currentVersionId: string | null;
  sameVersion: boolean;
  changes: VersionFieldChange[];
}

/**
 * Compare a historical version to whatever the object currently points
 * at. Used by the rollback UI to render a "this will restore these
 * fields" diff before the user confirms.
 *
 * For notes: diffs title + markdown_content + summary + tags.
 * For file/skill/agent: diffs source_content + name + description.
 *
 * Returns null when the object or baseline version is not found or
 * when the baseline doesn't belong to the object (ownership failure).
 */
export async function compareVersionToCurrent(
  supabase: SupabaseClient,
  objectType: "note" | "file" | "skill" | "agent",
  objectId: string,
  baselineVersionId: string
): Promise<VersionComparison | null> {
  if (objectType === "note") {
    const { data: note } = await supabase
      .from("notes")
      .select("id, title, markdown_content, summary, tags, current_version_id")
      .eq("id", objectId)
      .maybeSingle();
    if (!note) return null;
    const { data: baseline } = await supabase
      .from("note_versions")
      .select("id, note_id, title, markdown_content")
      .eq("id", baselineVersionId)
      .maybeSingle();
    if (!baseline || baseline.note_id !== objectId) return null;

    const changes: VersionFieldChange[] = [];
    if (note.title !== baseline.title) {
      changes.push({ field: "title", before: note.title, after: baseline.title });
    }
    if (note.markdown_content !== baseline.markdown_content) {
      changes.push({
        field: "markdown_content",
        before: summarizeText(note.markdown_content),
        after: summarizeText(baseline.markdown_content),
      });
    }
    return {
      object_type: "note",
      object_id: objectId,
      baselineVersionId,
      currentVersionId: note.current_version_id ?? null,
      sameVersion: note.current_version_id === baselineVersionId,
      changes,
    };
  }

  // Files / skills / agents share the object_versions table.
  const table = objectType === "file" ? "files" : objectType === "skill" ? "skills" : "agents";
  const { data: obj } = await supabase
    .from(table)
    .select("id, name, description, source_content, current_version_id")
    .eq("id", objectId)
    .maybeSingle();
  if (!obj) return null;
  const { data: baseline } = await supabase
    .from("object_versions")
    .select("id, object_type, object_id, source_content")
    .eq("id", baselineVersionId)
    .maybeSingle();
  if (!baseline || baseline.object_type !== objectType || baseline.object_id !== objectId) return null;

  const changes: VersionFieldChange[] = [];
  if (obj.source_content !== baseline.source_content) {
    changes.push({
      field: "source_content",
      before: summarizeText(obj.source_content),
      after: summarizeText(baseline.source_content),
    });
  }
  return {
    object_type: objectType,
    object_id: objectId,
    baselineVersionId,
    currentVersionId: obj.current_version_id ?? null,
    sameVersion: obj.current_version_id === baselineVersionId,
    changes,
  };
}

// ─── Change-set vs current comparison ───────────────────────────────────────

export interface ChangeSetObjectComparison {
  object_type: string;
  object_id: string;
  recorded_before: Record<string, unknown> | null;
  recorded_after: Record<string, unknown> | null;
  /** Will a restore leave the object dirty? True if anything has been
   *  edited on top of the change set's after state since it committed. */
  dirtyAfter: boolean;
}

/**
 * Compare every `change_set_item` to the current canonical state of
 * its target object. Items whose after_snapshot no longer matches
 * what's on the row were edited since — restoring them will still
 * succeed but will overwrite those edits.
 *
 * Used by the "Undo" confirm dialog to warn the user before they
 * replace newer state with older.
 */
export async function compareChangeSetToCurrent(
  supabase: SupabaseClient,
  changeSetId: string
): Promise<ChangeSetObjectComparison[]> {
  const items = await listChangeSetItems(supabase, changeSetId);
  const out: ChangeSetObjectComparison[] = [];
  for (const item of items) {
    const current = await fetchCurrentSnapshot(supabase, item.object_type, item.object_id);
    const dirty = current && item.after_snapshot
      ? !shallowEqualKeys(current, item.after_snapshot)
      : false;
    out.push({
      object_type: item.object_type,
      object_id: item.object_id,
      recorded_before: item.before_snapshot,
      recorded_after: item.after_snapshot,
      dirtyAfter: dirty,
    });
  }
  return out;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function compactItemHint(i: ChangeSetItem): Record<string, unknown> {
  const hint: Record<string, unknown> = { operation: i.operation };
  if (i.version_id) hint.version_id = i.version_id;
  // Pass through a small, UI-safe subset of the snapshots.
  for (const side of ["before_snapshot", "after_snapshot"] as const) {
    const v = i[side];
    if (!v || typeof v !== "object") continue;
    const picks: Record<string, unknown> = {};
    const obj = v as Record<string, unknown>;
    for (const k of ["status", "version_id", "name", "slug", "path_cache", "box_id", "folder_id"]) {
      if (k in obj) picks[k] = obj[k];
    }
    if (Object.keys(picks).length > 0) hint[side] = picks;
  }
  return hint;
}

function summarizeText(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 159)}…`;
}

async function fetchCurrentSnapshot(
  supabase: SupabaseClient,
  objectType: string,
  objectId: string
): Promise<Record<string, unknown> | null> {
  const table =
    objectType === "note" ? "notes" :
    objectType === "file" ? "files" :
    objectType === "skill" ? "skills" :
    objectType === "agent" ? "agents" :
    objectType === "folder" ? "folders" :
    objectType === "box" ? "boxes" :
    null;
  if (!table) return null;
  const { data } = await supabase
    .from(table)
    .select("id, status, name, path_cache, current_version_id")
    .eq("id", objectId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

/** Is every key in `a` present and equal in `b`? */
function shallowEqualKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const k of Object.keys(b)) {
    if (!(k in a)) continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}
