"use client";
import { Component, ReactNode, ErrorInfo } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

/**
 * Section-level error boundary.
 *
 * When something inside the boundary throws, we surface a clean,
 * centered empty-state pattern: a 24px muted icon, a title, a short
 * description, and a single primary <Button> to retry. No decorative
 * elements, no red wash — the message carries the weight.
 *
 * Behavior is preserved: callers may still pass a custom `fallback`
 * node, and the retry handler resets the error state in place.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to Sentry if available
    if (typeof window !== "undefined" && (window as unknown as { Sentry?: { captureException: (e: Error, ctx: unknown) => void } }).Sentry) {
      (window as unknown as { Sentry: { captureException: (e: Error, ctx: unknown) => void } }).Sentry.captureException(error, { extra: { info } });
    }
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-10 text-center"
        >
          <AlertCircle
            className="size-6 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-base font-medium text-foreground">
              Something went wrong
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              We hit an unexpected error rendering this section. You can try again
              without leaving the page.
            </p>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={() => this.setState({ error: null })}
            className="mt-1"
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
