"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Root-level error boundary.
 *
 * Catches unhandled errors that escape all nested error boundaries,
 * including errors in the root layout itself. Because this replaces
 * the entire <html> tree, it must render a full document. The Tailwind
 * design tokens are unavailable here (the CSS may not have loaded), so
 * inline styles mirror the enterprise neutral surface palette.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          backgroundColor: "#fdfdfc",
          color: "#1a1a1a",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "2rem",
            maxWidth: "28rem",
          }}
        >
          {/* Brand mark — small yellow square + wordmark */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.625rem",
              marginBottom: "2rem",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "block",
                width: "1.25rem",
                height: "1.25rem",
                borderRadius: "3px",
                backgroundColor: "#FACC15",
              }}
            />
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              Poggle
            </span>
          </div>

          <h2
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              letterSpacing: "-0.018em",
              margin: "0 0 0.5rem 0",
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              color: "#666",
              fontSize: "0.875rem",
              lineHeight: 1.55,
              margin: "0 0 1.25rem 0",
            }}
          >
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: "0.6875rem",
                color: "#999",
                margin: "0 0 1.5rem 0",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <div
            style={{
              display: "inline-flex",
              gap: "0.5rem",
              justifyContent: "center",
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                borderRadius: "9999px",
                border: "1px solid #d4a40e",
                backgroundColor: "#FACC15",
                color: "#1a1a1a",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                borderRadius: "9999px",
                border: "1px solid #e5e5e5",
                background: "#fff",
                color: "#1a1a1a",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
