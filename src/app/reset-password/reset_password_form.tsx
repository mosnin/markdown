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

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {/* New password */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-sm font-medium text-foreground">
          New password
        </label>
        <PasswordInput
          id="new-password"
          name="password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          disabled={pending}
        />
      </div>

      {/* Confirm password */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
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
