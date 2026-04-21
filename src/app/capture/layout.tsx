import type { ReactNode } from "react";

/**
 * Capture layout — strips all desktop chrome. The capture surface is
 * mobile-first; the only ambient UI is the capture form itself. Auth
 * is enforced inside each page (capture page redirects to /sign_in
 * when not authenticated).
 */
export default function CaptureLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {children}
    </div>
  );
}
