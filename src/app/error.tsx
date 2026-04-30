"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-12 text-center">
      {/* Brand mark */}
      <Link href="/" className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="block h-5 w-5 rounded-[3px] bg-brand"
        />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Poggle
        </span>
      </Link>

      <div className="max-w-md space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          An unexpected error occurred. Your data is safe — refresh the page or
          try again.
        </p>
        {error.digest && (
          <p className="font-mono text-[11px] text-muted-foreground/60">
            Error ID: {error.digest}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={reset}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
        <Button
          variant="outline"
          onClick={() => (window.location.href = "/app")}
        >
          Go home
        </Button>
      </div>
    </div>
  );
}
