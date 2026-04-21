"use client";
import { Component, ReactNode, ErrorInfo } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

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
      return this.props.fallback ?? (
        <div role="alert" className="p-4 rounded bg-red-50 text-red-900">
          <p className="font-medium">Something went wrong in this section.</p>
          <button onClick={() => this.setState({ error: null })} className="mt-2 underline">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
