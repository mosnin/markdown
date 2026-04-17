"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Fingerprint } from "lucide-react";
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
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
        onClick={() => setShow((v) => !v)}
      >
        {show ? (
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        )}
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

// ─── Passkey sign-in button ──────────────────────────────────────────────────

function PasskeySignInButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasskeySignIn() {
    setError(null);
    setLoading(true);

    try {
      // Dynamically import the browser module to avoid SSR issues.
      const { startAuthentication } = await import("@simplewebauthn/browser");

      // 1. Get authentication options.
      const optionsRes = await fetch(
        "/api/auth/webauthn/authenticate/options",
        { method: "POST" },
      );
      if (!optionsRes.ok) throw new Error("Failed to get authentication options");
      const options = await optionsRes.json();

      // 2. Start the browser WebAuthn ceremony.
      const credential = await startAuthentication({ optionsJSON: options });

      // 3. Verify with the server (creates a session).
      const verifyRes = await fetch(
        "/api/auth/webauthn/authenticate/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: credential }),
        },
      );

      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.error ?? "Authentication failed");
      }

      // 4. Redirect to the app.
      window.location.href = "/welcome";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Passkey sign-in failed";
      // Don't show error for user cancellation.
      if (
        !message.includes("cancelled") &&
        !message.includes("canceled") &&
        !message.includes("AbortError")
      ) {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        className="w-full"
        onClick={handlePasskeySignIn}
      >
        <Fingerprint className="mr-2 h-4 w-4" />
        {loading ? "Authenticating..." : "Sign in with passkey"}
      </Button>
    </div>
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

      {/* Passkey sign-in */}
      <div className="relative my-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <PasskeySignInButton />

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
  const [agreed, setAgreed] = useState(false);

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

      {/* Terms & Privacy agreement — required */}
      <div className="mt-1 flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3">
        <input
          id="signup-agree"
          name="agreeToTerms"
          type="checkbox"
          value="yes"
          required
          checked={agreed}
          disabled={pending}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <label htmlFor="signup-agree" className="cursor-pointer text-xs leading-relaxed text-muted-foreground">
          I am at least 16 years old and I agree to the{" "}
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-violet-500"
          >
            Terms of Service
          </Link>
          ,{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-violet-500"
          >
            Privacy Policy
          </Link>
          ,{" "}
          <Link
            href="/acceptable-use"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-violet-500"
          >
            Acceptable Use Policy
          </Link>
          , and{" "}
          <Link
            href="/cookies"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-violet-500"
          >
            Cookie Policy
          </Link>
          .
        </label>
      </div>

      {/* Error */}
      {state.status === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending || !agreed} className="mt-1 w-full">
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
