import { type ReactNode } from "react";
import { requireAuthenticatedUser } from "@/server/auth/require_authenticated_user";
import { ToastProvider } from "@/components/product/toast_provider";

/**
 * Guided 5-minute onboarding flow.
 *
 * Sits outside the main /app shell so the user can focus on the four
 * setup steps without sidebar / breadcrumb chrome distracting from the
 * task at hand. Auth is still required — viewers who land here are
 * bounced to /sign_in by `requireAuthenticatedUser`.
 *
 * The flow is intentionally a thin progressive form:
 *   step 1 → pick starting point (creates a real box server-side)
 *   step 2 → write or paste a single note (creates a real note)
 *   step 3 → bundle for AI (uses the existing bundle assemble action)
 *   step 4 → try it (open Claude / GPT, then continue to /app)
 *
 * Progress is tracked in localStorage on the client side — see
 * `welcome_setup_progress.ts` for the shape and helpers. We picked
 * localStorage over a `setup_progress` JSON profile column because:
 *   1. It avoids a schema migration for a four-step ephemeral flow.
 *   2. The data is non-authoritative — a refresh from a different device
 *      simply restarts at step 1, which is the right product behaviour.
 *   3. Server actions still create real boxes / notes and revalidate
 *      the relevant paths, so the user's data is durable even if their
 *      progress cookie isn't.
 */
export default async function WelcomeSetupLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAuthenticatedUser();

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-background">{children}</div>
    </ToastProvider>
  );
}
