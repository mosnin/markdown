/**
 * Cached server reads — React `cache()` wrappers.
 *
 * React `cache()` deduplicates calls with the same arguments within a
 * single server-component render pass.  It does NOT persist across
 * requests.  This is ideal for pages where multiple server components
 * (or a page + assembleContextBundle) hit the same repository
 * functions with identical arguments during the same render.
 *
 * API routes and server actions should continue importing the
 * uncached originals directly — React cache scoping does not apply
 * there and wrapping adds no benefit.
 */
import { cache } from "react";

import { getNoteById } from "@/server/repositories/note_repository";
import { getBoxById } from "@/server/repositories/box_repository";
import {
  assembleContextBundle,
  type AssembleBundleOptions,
} from "@/server/services/context_bundle_service";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Repository-level cached reads ──────────────────────────────────────────

/**
 * Cached `getNoteById`.
 *
 * The notes/[note_id] page fetches the target note for its own
 * rendering, and `assembleContextBundle` fetches the same note
 * internally (step 1 of the assembly pipeline).  Wrapping with
 * `cache()` collapses these into a single Supabase round-trip.
 */
export const getCachedNoteById = cache(getNoteById);

/**
 * Cached `getBoxById`.
 *
 * Same duplication pattern: the page verifies workspace ownership via
 * the box, and `assembleContextBundle` does the same check internally.
 */
export const getCachedBoxById = cache(getBoxById);

// ─── Service-level cached reads ─────────────────────────────────────────────

/**
 * Cached `assembleContextBundle`.
 *
 * The bundle viewer component may re-invoke the same assembly during
 * a single server render (e.g. page + child server component).
 * Wrapping with `cache()` ensures the expensive multi-query pipeline
 * runs at most once per (supabase, workspaceId, noteId, options)
 * tuple within a render pass.
 *
 * Note: React `cache()` compares arguments with `Object.is`, so
 * callers must pass the same SupabaseClient instance and identical
 * primitive arguments for dedup to activate.  Options objects are
 * compared by reference — pass `undefined` (or omit) for defaults to
 * get the best hit rate.
 */
export const getCachedContextBundle = cache(
  async (
    supabase: SupabaseClient,
    workspaceId: string,
    noteId: string,
    options?: AssembleBundleOptions,
  ) => {
    return assembleContextBundle(supabase, workspaceId, noteId, options);
  },
);
