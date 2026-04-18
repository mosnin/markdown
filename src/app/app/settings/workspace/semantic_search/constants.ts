/**
 * Shared constants for the workspace semantic search admin surface.
 *
 * Kept in a plain module so both client components and the
 * `"use server"` action module can import them (a "use server" file
 * may only export async functions and types).
 */

export const REINDEX_INLINE_THRESHOLD = 100;
export const REINDEX_MAX_PER_CALL = 500;
