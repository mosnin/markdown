"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuthState =
  | { status: "idle" }
  | { status: "confirm"; message: string }
  | { status: "error"; message: string };

// ─── Sign in ─────────────────────────────────────────────────────────────────

export async function signIn(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get("email") as string | null)?.trim();
  const password = formData.get("password") as string | null;

  if (!email || !password) {
    return { status: "error", message: "Email and password are required." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const message =
      error.status === 429
        ? "Too many attempts. Please wait a moment before trying again."
        : "Invalid email or password.";
    return { status: "error", message };
  }

  redirect("/welcome");
}

// ─── Reset password request ───────────────────────────────────────────────────

export async function requestPasswordReset(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get("email") as string | null)?.trim();

  if (!email) {
    return { status: "error", message: "Email address is required." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    const message =
      error.status === 429
        ? "Too many attempts. Please wait a moment before trying again."
        : "Could not send reset email. Please try again.";
    return { status: "error", message };
  }

  return {
    status: "confirm",
    message: "Check your email for a password reset link. It expires in 1 hour.",
  };
}

// ─── Update password (authenticated, after reset link) ───────────────────────

export type UpdatePasswordState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const password = formData.get("password") as string | null;
  const confirmPassword = formData.get("confirmPassword") as string | null;

  if (!password || !confirmPassword) {
    return { status: "error", message: "Both fields are required." };
  }

  if (password.length < 8) {
    return { status: "error", message: "Password must be at least 8 characters." };
  }

  if (password !== confirmPassword) {
    return { status: "error", message: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return {
      status: "error",
      message: error.message ?? "Could not update password. Please try again.",
    };
  }

  redirect("/app");
}

// ─── Sign up ─────────────────────────────────────────────────────────────────

export async function signUp(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get("email") as string | null)?.trim();
  const password = formData.get("password") as string | null;
  const confirmPassword = formData.get("confirmPassword") as string | null;

  if (!email || !password || !confirmPassword) {
    return { status: "error", message: "All fields are required." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Enter a valid email address." };
  }

  if (password.length < 8) {
    return {
      status: "error",
      message: "Password must be at least 8 characters.",
    };
  }

  if (password !== confirmPassword) {
    return { status: "error", message: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) {
    const message =
      error.status === 429
        ? "Too many attempts. Please wait a moment before trying again."
        : error.message ?? "Could not create account. Please try again.";
    return { status: "error", message };
  }

  return {
    status: "confirm",
    message:
      "Check your email to confirm your account. The link expires in 1 hour.",
  };
}
