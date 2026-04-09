"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server action: sign the current user out.
 *
 * Clears the Supabase session cookie and redirects to /sign_in.
 * Call this from a Client Component form or button.
 */
export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign_in");
}
