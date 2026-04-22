"use server";

import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type DeleteAccountResult = { ok: false; error: string };

export async function deleteAccountAction(): Promise<DeleteAccountResult | never> {
  const ctx = await requireAuthenticatedUser();
  const userId = ctx.user.id;

  // Use the per-request cookie client to sign out first so the session
  // is invalidated before we nuke the user row. The admin client is used
  // for the actual user deletion since it bypasses RLS.
  const supabase = await createClient();
  await supabase.auth.signOut();

  // The admin client has permission to delete auth.users rows. Deleting the
  // user cascades to workspace_memberships which cascades to workspace data
  // via the FK chain set up in the migrations.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  // Redirect to the home page after deletion — the session is gone so
  // /app would just redirect to sign-in anyway.
  redirect("/");
}
