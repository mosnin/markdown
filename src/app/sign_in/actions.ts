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
