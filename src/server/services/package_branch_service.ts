import { type SupabaseClient } from "@supabase/supabase-js";
import { listBranchHeads } from "./branch_service";

/**
 * Package-aware branch service for Skills and Agents.
 *
 * Skills and Agents are *package* objects: a canonical editable source
 * plus any number of child files plus (eventually) nested folders.
 * Branch-aware writes already work on the canonical source, and
 * editing a child file on a branch already creates a branch_heads
 * row for the child file. What was missing: no surface that treated
 * the package as a coherent draft unit.
 *
 * This module adds three pieces:
 *
 *   1. `branch_package_metadata` overlay — stores per-branch metadata
 *      overrides (description, tags, summary, agent_type, model_hint,
 *      system_prompt) without mutating the canonical row. See the
 *      migration 20260412000007.
 *   2. Package membership derivation — computes which child files
 *      belong to a Skill's or Agent's package draft by joining
 *      branch_heads (type='file') against `files.parent_skill_id` /
 *      `files.parent_agent_id`. No new membership table needed
 *      because parent pointers already exist on the files row.
 *   3. Package draft state — combines the canonical source branch
 *      head, child file branch heads, and metadata overlay into a
 *      single shape the UI + promote path can consume.
 *
 * Structural package changes (adding or removing child files on a
 * branch) are out of scope in this pass — child file *creation*
 * still lands on main directly. Closing that gap needs a
 * pending-object concept the repo doesn't have yet.
 */

export type PackageType = "skill" | "agent";

export interface PackageMetadataOverlay {
  branch_id: string;
  package_type: PackageType;
  package_id: string;
  name: string | null;
  description: string | null;
  tags: string[] | null;
  summary: string | null;
  agent_type: string | null;
  model_hint: string | null;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields we track as "branch-aware metadata" for each package type.
 *  `name` is branch-overrideable on both skills and agents — that's
 *  what closes the `renameSkillAction` leak. */
const METADATA_FIELDS_BY_TYPE: Record<PackageType, readonly string[]> = {
  skill: ["name", "description", "tags", "summary"],
  agent: ["name", "description", "tags", "summary", "agent_type", "model_hint", "system_prompt"],
};

export function branchableMetadataFieldsFor(type: PackageType): readonly string[] {
  return METADATA_FIELDS_BY_TYPE[type];
}

// ─── Overlay CRUD ────────────────────────────────────────────────────────────

export async function getPackageMetadataOverlay(
  supabase: SupabaseClient,
  branchId: string,
  packageType: PackageType,
  packageId: string
): Promise<PackageMetadataOverlay | null> {
  const { data } = await supabase
    .from("branch_package_metadata")
    .select("*")
    .eq("branch_id", branchId)
    .eq("package_type", packageType)
    .eq("package_id", packageId)
    .maybeSingle();
  return (data as PackageMetadataOverlay | null) ?? null;
}

export interface UpsertOverlayInput {
  branchId: string;
  packageType: PackageType;
  packageId: string;
  /** Only declared fields are written; undefined means "leave whatever
   *  the overlay row already had". Pass null to explicitly clear a
   *  previously-set override. */
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  summary?: string | null;
  agent_type?: string | null;
  model_hint?: string | null;
  system_prompt?: string | null;
}

/**
 * Write or update the overlay for a branch + package pair. The field
 * list is filtered against what's legal for the package_type — agent-
 * specific fields passed for a skill are silently dropped rather
 * than 400'd, matching the main services' tolerance.
 */
export async function upsertPackageMetadataOverlay(
  supabase: SupabaseClient,
  input: UpsertOverlayInput
): Promise<PackageMetadataOverlay> {
  const legal = new Set(branchableMetadataFieldsFor(input.packageType));
  const patch: Record<string, unknown> = {
    branch_id: input.branchId,
    package_type: input.packageType,
    package_id: input.packageId,
  };
  if (legal.has("name") && input.name !== undefined) patch.name = input.name;
  if (legal.has("description") && input.description !== undefined) patch.description = input.description;
  if (legal.has("tags") && input.tags !== undefined) patch.tags = input.tags;
  if (legal.has("summary") && input.summary !== undefined) patch.summary = input.summary;
  if (legal.has("agent_type") && input.agent_type !== undefined) patch.agent_type = input.agent_type;
  if (legal.has("model_hint") && input.model_hint !== undefined) patch.model_hint = input.model_hint;
  if (legal.has("system_prompt") && input.system_prompt !== undefined) patch.system_prompt = input.system_prompt;

  const { data, error } = await supabase
    .from("branch_package_metadata")
    .upsert(patch, { onConflict: "branch_id,package_type,package_id" })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to upsert package metadata overlay");
  return data as PackageMetadataOverlay;
}

// ─── Membership ──────────────────────────────────────────────────────────────

export interface PackageChildHead {
  /** branch_heads.id of the child file's head on this branch. */
  branchHeadId: string;
  fileId: string;
  versionId: string;
  fileName: string;
  filePathCache: string | null;
}

/**
 * Return every child file that is part of a (branch, package) draft
 * state. "Part of" = the branch has a head row for a file AND that
 * file's canonical parent_skill_id / parent_agent_id points at this
 * package.
 *
 * We don't persist membership separately because parent pointers are
 * already canonical — a child file cannot become part of a different
 * package without a main move, and main moves have their own change
 * set. This keeps the membership derivation stable and obvious.
 */
export async function computePackageBranchMembership(
  supabase: SupabaseClient,
  branchId: string,
  packageType: PackageType,
  packageId: string
): Promise<PackageChildHead[]> {
  const heads = await listBranchHeads(supabase, branchId);
  const fileHeads = heads.filter((h) => h.object_type === "file");
  if (fileHeads.length === 0) return [];

  const ids = fileHeads.map((h) => h.object_id);
  const parentCol = packageType === "skill" ? "parent_skill_id" : "parent_agent_id";
  const { data: files } = await supabase
    .from("files")
    .select(`id, name, path_cache, ${parentCol}`)
    .in("id", ids)
    .eq(parentCol, packageId);

  const fileIndex = new Map(
    (files ?? []).map((f: { id: string; name: string; path_cache: string | null }) => [f.id, f])
  );

  const out: PackageChildHead[] = [];
  for (const head of fileHeads) {
    const file = fileIndex.get(head.object_id);
    if (!file) continue;
    out.push({
      branchHeadId: head.id,
      fileId: head.object_id,
      versionId: head.version_id,
      fileName: file.name,
      filePathCache: file.path_cache,
    });
  }
  return out;
}

// ─── Draft state ─────────────────────────────────────────────────────────────

export interface PackageDraftState {
  packageType: PackageType;
  packageId: string;
  /** branch_heads.version_id for the canonical source, if the branch
   *  has edited the source. Null → main canonical source unchanged. */
  canonicalSourceVersionId: string | null;
  /** Child files this branch has edited that belong to the package. */
  childHeads: PackageChildHead[];
  /** Metadata overlay row, if any. */
  metadataOverlay: PackageMetadataOverlay | null;
  /** Convenience: does the branch contain anything at all for the package? */
  hasAnyChanges: boolean;
}

/**
 * Build the full package draft state for a Skill or Agent on a
 * branch. Cheap enough to call on every page render; three small
 * round trips.
 */
export async function getPackageDraftState(
  supabase: SupabaseClient,
  branchId: string | null | undefined,
  packageType: PackageType,
  packageId: string
): Promise<PackageDraftState | null> {
  if (!branchId) return null;

  const [canonical, children, overlay] = await Promise.all([
    resolveCanonicalSourceHead(supabase, branchId, packageType, packageId),
    computePackageBranchMembership(supabase, branchId, packageType, packageId),
    getPackageMetadataOverlay(supabase, branchId, packageType, packageId),
  ]);

  const hasAnyChanges = !!canonical || children.length > 0 || !!overlay;
  if (!hasAnyChanges) return null;

  return {
    packageType,
    packageId,
    canonicalSourceVersionId: canonical,
    childHeads: children,
    metadataOverlay: overlay,
    hasAnyChanges,
  };
}

async function resolveCanonicalSourceHead(
  supabase: SupabaseClient,
  branchId: string,
  packageType: PackageType,
  packageId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("branch_heads")
    .select("version_id")
    .eq("branch_id", branchId)
    .eq("object_type", packageType)
    .eq("object_id", packageId)
    .maybeSingle();
  return (data?.version_id as string | undefined) ?? null;
}

// ─── Admin purge ─────────────────────────────────────────────────────────────

/**
 * Delete every `branch_package_metadata` overlay row whose parent branch
 * has reached a terminal status (`discarded` or `promoted`) within the
 * given workspace.
 *
 * SECURITY: rows whose parent branch is still `open` are NEVER deleted —
 * they belong to live drafts and must survive until that branch is either
 * promoted or discarded.
 *
 * The function is intentionally pure: it accepts a supabase client and a
 * workspaceId and performs no authentication or role checks itself. The
 * server action wrapper is responsible for access control.
 *
 * Implementation uses a two-step approach compatible with the Supabase JS
 * client: first fetch the eligible branch IDs, then delete overlays for
 * those IDs. This is equivalent to a single-pass
 *   DELETE … WHERE branch_id IN (SELECT id FROM draft_branches WHERE …)
 * at the query level, just split across two round-trips.
 */
export async function purgeDiscardedOverlays(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<{ deletedCount: number }> {
  // Step 1: collect branch IDs in this workspace that are terminal.
  const { data: branches, error: fetchError } = await supabase
    .from("draft_branches")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("status", ["discarded", "promoted"]);

  if (fetchError) throw new Error(fetchError.message);

  const branchIds = (branches ?? []).map((b: { id: string }) => b.id);
  if (branchIds.length === 0) return { deletedCount: 0 };

  // Step 2: delete overlays for those branches and count the rows.
  const { data: deleted, error: deleteError } = await supabase
    .from("branch_package_metadata")
    .delete()
    .in("branch_id", branchIds)
    .select("id");

  if (deleteError) throw new Error(deleteError.message);

  return { deletedCount: (deleted ?? []).length };
}

// ─── Apply overlay on read ───────────────────────────────────────────────────

/**
 * Patch a loaded skill/agent row with the branch overlay's fields.
 * No-ops when `overlay` is null. Nullable-ness of the overlay column
 * disambiguates "clear override" from "no override": an explicit
 * null in the column clears the corresponding main value on read;
 * an absent row leaves main alone.
 */
export function applyPackageMetadataOverlay<T extends Record<string, unknown>>(
  row: T,
  overlay: PackageMetadataOverlay | null
): T {
  if (!overlay) return row;
  const out = { ...row };
  const fields = branchableMetadataFieldsFor(overlay.package_type);
  for (const f of fields) {
    const v = (overlay as unknown as Record<string, unknown>)[f];
    // Null means "no override" (the overlay row stores null for every
    // column the user hasn't set yet). Only non-null values patch the
    // returned row. Callers that need "explicit clear" semantics can
    // wait for a future extension — the write surface currently has
    // no way to express it anyway (upserts only land declared fields).
    if (v !== null && v !== undefined) {
      (out as Record<string, unknown>)[f] = v;
    }
  }
  return out;
}
