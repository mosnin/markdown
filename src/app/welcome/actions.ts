"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Mark the signed-in user as having seen the first-run welcome wizard.
 *
 * Persisted in Supabase auth `user_metadata` (same place signup records the
 * terms-consent stamp), so the wizard shows exactly once per account with no
 * extra table or migration. Non-critical: failures are swallowed so a metadata
 * hiccup can never strand the user on /welcome — they still proceed to /app.
 */
export async function markOnboarded(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.updateUser({
      data: { onboarded_at: new Date().toISOString() },
    });
  } catch {
    // Best-effort; the client navigates to /app regardless.
  }
}
