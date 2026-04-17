"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * App section error boundary.
 *
 * Catches unexpected exceptions within the /app/* routes, rendered inside the
 * app shell layout (sidebar, topbar present). Preserves navigation context so
 * the user can easily move to another section.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Something went wrong
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page encountered an unexpected error. Your notes and boxes are
          unaffected.
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
        <Button variant="outline" size="sm" render={<a href="/app" />}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
