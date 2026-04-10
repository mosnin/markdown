"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, signUp, requestPasswordReset, type AuthState } from "./actions";

const INITIAL: AuthState = { status: "idle" };

// ─── Password field with show/hide toggle ────────────────────────────────────

function PasswordInput({
  id,
  name,
  placeholder,
  disabled,
  autoComplete,
}: {
  id: string;
  name: string;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        disabled={disabled}
        className="h-9 pr-9"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ─── Confirm view (post sign-up) ─────────────────────────────────────────────

function ConfirmView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
        <span className="text-xl">✉️</span>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Almost there</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <p className="text-xs text-muted-foreground/70">
        Check your spam folder if you don&apos;t see it.
      </p>
    </div>
  );
}

// ─── Forgot password form ────────────────────────────────────────────────────

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, { status: "idle" } as AuthState);

  if (state.status === "confirm") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
          <span className="text-xl">✉️</span>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-foreground">Check your email</p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
          onClick={onBack}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Reset your password</p>
        <p className="text-xs text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-email" className="text-sm font-medium text-foreground">
          Email address
        </label>
        <Input
          id="reset-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
          className="h-9"
        />
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-xs text-destructive">{state.message}</p>
      )}

      <Button type="submit" disabled={pending} className="mt-1 w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={onBack}
        >
          Back to sign in
        </button>
      </p>
    </form>
  );
}

// ─── Login form ──────────────────────────────────────────────────────────────

function LoginForm({
  onSwitch,
  onForgotPassword,
}: {
  onSwitch: () => void;
  onForgotPassword: () => void;
}) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signin-email" className="text-sm font-medium text-foreground">
          Email address
        </label>
        <Input
          id="signin-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
          className="h-9"
        />
      </div>

      {/* Password */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="signin-password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
            onClick={onForgotPassword}
          >
            Forgot password?
          </button>
        </div>
        <PasswordInput
          id="signin-password"
          name="password"
          placeholder="••••••••"
          autoComplete="current-password"
          disabled={pending}
        />
      </div>

      {/* Error */}
      {state.status === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending} className="mt-1 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Don&apos;t have an account?{" "}
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={onSwitch}
        >
          Create one
        </button>
      </p>
    </form>
  );
}

// ─── Sign-up form ─────────────────────────────────────────────────────────────

function SignUpForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, formAction, pending] = useActionState(signUp, INITIAL);

  if (state.status === "confirm") {
    return <ConfirmView message={state.message} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-email" className="text-sm font-medium text-foreground">
          Email address
        </label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
          className="h-9"
        />
      </div>

      {/* Password */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <PasswordInput
          id="signup-password"
          name="password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          disabled={pending}
        />
      </div>

      {/* Confirm password */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-confirm" className="text-sm font-medium text-foreground">
          Confirm password
        </label>
        <PasswordInput
          id="signup-confirm"
          name="confirmPassword"
          placeholder="••••••••"
          autoComplete="new-password"
          disabled={pending}
        />
      </div>

      {/* Error */}
      {state.status === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending} className="mt-1 w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={onSwitch}
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

// ─── Auth panel ──────────────────────────────────────────────────────────────

export function AuthPanel({
  defaultMode = "signin",
}: {
  defaultMode?: "signin" | "signup";
}) {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(defaultMode);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Mode toggle — hidden in forgot-password view */}
      {mode !== "forgot" && (
        <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
      )}

      {/* Form */}
      {mode === "signin" && (
        <LoginForm
          onSwitch={() => setMode("signup")}
          onForgotPassword={() => setMode("forgot")}
        />
      )}
      {mode === "signup" && (
        <SignUpForm onSwitch={() => setMode("signin")} />
      )}
      {mode === "forgot" && (
        <ForgotPasswordForm onBack={() => setMode("signin")} />
      )}
    </div>
  );
}
