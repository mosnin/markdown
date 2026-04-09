"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInWithEmail, type SignInState } from "./actions";

const initialState: SignInState = { status: "idle" };

// ─── Success view ─────────────────────────────────────────────────────────────

function SignInSuccess() {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Mail className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link. Click it to continue — no password needed.
        </p>
      </div>
      <p className="text-xs text-muted-foreground/70">
        The link expires in 1 hour. Check your spam folder if you don&apos;t
        see it.
      </p>
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────

export function SignInForm() {
  const [state, formAction, pending] = useActionState(
    signInWithEmail,
    initialState
  );

  if (state.status === "success") {
    return <SignInSuccess />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email address
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={pending}
          aria-describedby={
            state.status === "error" ? "sign-in-error" : undefined
          }
          className="h-9"
        />
        {state.status === "error" && (
          <p
            id="sign-in-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {state.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending link\u2026" : "Send magic link"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        We&apos;ll email you a sign-in link. No password required.
      </p>
    </form>
  );
}
