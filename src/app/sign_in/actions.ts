"use server";

import { createClient } from "@/lib/supabase/server";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SignInState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

// ─── Action ──────────────────────────────────────────────────────────────────

/**
 * Server action: request a magic link for the given email.
 *
 * Compatible with React 19 `useActionState`. Accepts `prevState` and
 * `formData` and returns the next state.
 *
 * On success the user receives an email with a sign-in link that routes
 * through /auth/callback, which exchanges the code for a session and
 * redirects to /app.
 */
export async function signInWithEmail(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = (formData.get("email") as string | null)?.trim();

  if (!email) {
    return { status: "error", message: "Email address is required." };
  }

  // Basic format check before hitting Supabase.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // The callback URL must be in the "Redirect URLs" allow-list in your
      // Supabase project: Authentication → URL Configuration.
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    // Surface a clean message — avoid leaking Supabase internals.
    const message =
      error.status === 429
        ? "Too many requests. Please wait a moment before trying again."
        : "Could not send the sign-in link. Please try again.";
    return { status: "error", message };
  }

  return { status: "success" };
}
