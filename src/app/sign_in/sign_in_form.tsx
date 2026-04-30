"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Fingerprint, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, signUp, requestPasswordReset, type AuthState } from "./actions";
import { cn } from "@/lib/utils";

const INITIAL: AuthState = { status: "idle" };

// ─── Field primitives ────────────────────────────────────────────────────────

function Label({
  htmlFor,
  children,
  trailing,
}: {
  htmlFor: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-foreground"
      >
        {children}
      </label>
      {trailing}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-1.5 text-xs text-destructive">
      {children}
    </p>
  );
}

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
        className="pr-9"
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
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card">
        <MailCheck className="h-5 w-5 text-brand" aria-hidden="true" />
      </div>
      <div className="space-y-1">
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
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card">
          <MailCheck className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Check your email</p>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
        <Button variant="link" size="sm" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Reset your password</p>
        <p className="text-xs text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <div>
        <Label htmlFor="reset-email">Email address</Label>
        <Input
          id="reset-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
        />
      </div>

      {state.status === "error" && <ErrorText>{state.message}</ErrorText>}

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
      {error && <ErrorText>{error}</ErrorText>}
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        className="w-full"
        onClick={handlePasskeySignIn}
      >
        <Fingerprint className="h-4 w-4" aria-hidden="true" />
        {loading ? "Authenticating…" : "Sign in with passkey"}
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
    <form action={formAction} className="flex flex-col gap-4">
      {/* Email */}
      <div>
        <Label htmlFor="signin-email">Email address</Label>
        <Input
          id="signin-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
        />
      </div>

      {/* Password */}
      <div>
        <Label
          htmlFor="signin-password"
          trailing={
            <button
              type="button"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline underline-offset-2"
              onClick={onForgotPassword}
            >
              Forgot password?
            </button>
          }
        >
          Password
        </Label>
        <PasswordInput
          id="signin-password"
          name="password"
          placeholder="••••••••"
          autoComplete="current-password"
          disabled={pending}
        />
      </div>

      {/* Error */}
      {state.status === "error" && <ErrorText>{state.message}</ErrorText>}

      <Button type="submit" disabled={pending} className="mt-1 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      {/* Divider */}
      <div className="relative my-1">
        <div aria-hidden="true" className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            or
          </span>
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
    <form action={formAction} className="flex flex-col gap-4">
      {/* Email */}
      <div>
        <Label htmlFor="signup-email">Email address</Label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
        />
      </div>

      {/* Password */}
      <div>
        <Label htmlFor="signup-password">Password</Label>
        <PasswordInput
          id="signup-password"
          name="password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          disabled={pending}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          At least 8 characters.
        </p>
      </div>

      {/* Confirm password */}
      <div>
        <Label htmlFor="signup-confirm">Confirm password</Label>
        <PasswordInput
          id="signup-confirm"
          name="confirmPassword"
          placeholder="••••••••"
          autoComplete="new-password"
          disabled={pending}
        />
      </div>

      {/* Terms & Privacy agreement — required */}
      <div className="mt-1 flex items-start gap-2.5 rounded-md border border-border bg-muted/30 p-3">
        <input
          id="signup-agree"
          name="agreeToTerms"
          type="checkbox"
          value="yes"
          required
          checked={agreed}
          disabled={pending}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <label htmlFor="signup-agree" className="cursor-pointer text-xs leading-relaxed text-muted-foreground">
          I am at least 16 years old and I agree to the{" "}
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-brand"
          >
            Terms of Service
          </Link>
          ,{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-brand"
          >
            Privacy Policy
          </Link>
          ,{" "}
          <Link
            href="/acceptable-use"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-brand"
          >
            Acceptable Use Policy
          </Link>
          , and{" "}
          <Link
            href="/cookies"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-brand"
          >
            Cookie Policy
          </Link>
          .
        </label>
      </div>

      {/* Error */}
      {state.status === "error" && <ErrorText>{state.message}</ErrorText>}

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
    <div className="flex w-full flex-col gap-5">
      {/* Underline tabs — hidden in forgot-password view */}
      {mode !== "forgot" && (
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="flex border-b border-border"
        >
          {(["signin", "signup"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m)}
                className={cn(
                  "relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "signin" ? "Sign in" : "Create account"}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-brand"
                  />
                )}
              </button>
            );
          })}
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
