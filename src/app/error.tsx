"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Root-level error boundary.
 *
 * Catches unexpected exceptions that bubble up past all nested error boundaries.
 * Displayed as a full-page fallback; the error detail is logged to the console.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root error boundary]", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred. Your data is safe — refresh the page or
          try again.
        </p>
        {error.digest && (
          <p className="font-mono text-[11px] text-muted-foreground/50">
            Error ID: {error.digest}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={reset} size="sm" className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (window.location.href = "/app")}
        >
          Go home
        </Button>
      </div>
    </div>
  );
}
