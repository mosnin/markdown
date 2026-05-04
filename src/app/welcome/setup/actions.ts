"use server";

import {
  createBoxAction,
  createNoteAction,
  applyBoxTemplateAction,
} from "@/app/app/boxes/actions";
import { assembleContextBundleAction } from "@/app/app/notes/actions";
import { type ContextBundle } from "@/server/domain/types/context_bundle";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";

/**
 * Server actions for the welcome/setup flow.
 *
 * These wrap the canonical create / assemble actions so the onboarding
 * surface never bypasses audit, RLS, subscription limits, or revalidation.
 * No new tables, no special permissions — just a thin orchestration layer
 * that hands the user a working box + note + bundle in four clicks.
 */

export type SetupActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Step 1: pick a starting point ────────────────────────────────────────────

export interface CreateStartingBoxInput {
  /** "template" → also call applyBoxTemplateAction with templateId. */
  /** "blank" / "import" → just create the box, then route accordingly. */
  mode: "template" | "import" | "blank";
  /** Optional explicit box name. Defaults are picked per-mode. */
  name?: string;
  /** Required when mode === "template". */
  templateId?: string;
}

export async function createStartingBoxAction(
  input: CreateStartingBoxInput
): Promise<SetupActionResult<{ boxId: string }>> {
  // Re-check auth defensively — server actions can be invoked outside
  // the layout guard if the client crafts the call directly.
  await requireAuthenticatedUser();

  const defaultName =
    input.mode === "template"
      ? input.name ?? "My first box"
      : input.mode === "import"
        ? input.name ?? "Imported notes"
        : input.name ?? "My first box";

  const created = await createBoxAction(
    defaultName,
    "Created during Poggle setup."
  );
  if (!created.ok) return { ok: false, error: created.error };

  if (input.mode === "template" && input.templateId) {
    const applied = await applyBoxTemplateAction(
      created.data.id,
      input.templateId
    );
    if (!applied.ok) {
      // Box still exists — surface the template failure but keep the
      // boxId so the user can continue.
      return {
        ok: false,
        error: `Box created but template failed: ${applied.error}`,
      };
    }
  }

  return { ok: true, data: { boxId: created.data.id } };
}

// ─── Step 2: write or paste a single note ─────────────────────────────────────

export interface CreateSetupNoteInput {
  boxId: string;
  title: string;
  markdownContent: string;
}

export async function createSetupNoteAction(
  input: CreateSetupNoteInput
): Promise<SetupActionResult<{ noteId: string; slug: string }>> {
  await requireAuthenticatedUser();

  const trimmedTitle = input.title.trim() || "My first note";
  const result = await createNoteAction(
    input.boxId,
    trimmedTitle,
    null,
    "note",
    input.markdownContent
  );
  if (!result.ok) return { ok: false, error: result.error };

  // Slug is derived from the title for the bundle download filename.
  const slug = trimmedTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "note";

  return { ok: true, data: { noteId: result.data.id, slug } };
}

// ─── Step 3: bundle for an AI ─────────────────────────────────────────────────

export async function assembleSetupBundleAction(
  noteId: string
): Promise<SetupActionResult<ContextBundle>> {
  await requireAuthenticatedUser();
  return assembleContextBundleAction(noteId);
}
