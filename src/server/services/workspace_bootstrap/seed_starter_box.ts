import { type SupabaseClient } from "@supabase/supabase-js";
import { createBox } from "@/server/repositories/box_repository";
import { logger } from "@/lib/logger";

/**
 * Slug of the single starter box seeded into a brand-new workspace.
 *
 * Used as the idempotency key: the seed is only attempted on the
 * fresh-workspace-creation path (see get_or_create_default_workspace.ts),
 * but we additionally key the insert on this stable slug so a partial
 * failure — workspace row written, seed insert lost — never produces a
 * duplicate on a later login. `boxes` has a unique (workspace_id, slug)
 * index for non-trashed rows, so a re-attempt is a no-op conflict.
 */
export const STARTER_BOX_SLUG = "getting-started";

const STARTER_BOX_NAME = "Getting started";

/**
 * Short orientation copy carried in the box's `description`. This is the
 * first thing a new user (and any connected agent) sees, so it explains
 * the core loop in one breath. Kept under the 1000-char `description`
 * limit enforced by createBoxSchema.
 */
const STARTER_BOX_DESCRIPTION =
  "Your first context Box. Boxes hold the notes and files an AI agent reads as " +
  "workspace context. Connect an agent (Connect an agent in the sidebar), let it " +
  "read this context and propose changes, then approve those proposals in AI Edits " +
  "before anything is written. Rename or delete this Box anytime.";

/**
 * Seed a single starter Box into a freshly-created workspace.
 *
 * Contract:
 *   - Call this ONLY from the fresh-create branch of workspace bootstrap,
 *     never on the repair / already-exists path, and never when the user
 *     already owns workspaces. That gives us "first creation only".
 *   - Idempotent as a second line of defence: the insert is keyed on a
 *     stable slug, and a duplicate hits the unique (workspace_id, slug)
 *     index and is swallowed. Re-running never creates a second box.
 *   - Failure-isolated: any error is logged and swallowed. Seeding is a
 *     nicety; it must never break sign-in or the workspace bootstrap that
 *     the whole authenticated app depends on.
 *
 * We intentionally do NOT also create a guide *note* here. That would add
 * an RPC + workspace_objects insert + audit write to the auth hot path,
 * widening the failure surface for marginal benefit. The orientation copy
 * lives in the box description instead, and the in-app empty states carry
 * the rest of the activation guidance.
 */
export async function seedStarterBox(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<void> {
  try {
    await createBox(supabase, {
      workspace_id: workspaceId,
      name: STARTER_BOX_NAME,
      slug: STARTER_BOX_SLUG,
      description: STARTER_BOX_DESCRIPTION,
    });
  } catch (error) {
    // Most likely a unique-slug conflict from a re-attempt (benign) or a
    // transient DB error. Either way, bootstrap must continue: a missing
    // starter box degrades gracefully to the empty-state CTAs.
    logger.warn(
      { workspaceId, error },
      "[seed_starter_box] starter box seed skipped (non-fatal)"
    );
  }
}
