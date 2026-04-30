"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updatePassword, type UpdatePasswordState } from "@/app/sign_in/actions";

const INITIAL: UpdatePasswordState = { status: "idle" };

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

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* New password */}
      <div>
        <label
          htmlFor="new-password"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          New password
        </label>
        <PasswordInput
          id="new-password"
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
        <label
          htmlFor="confirm-password"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Confirm password
        </label>
        <PasswordInput
          id="confirm-password"
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
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
