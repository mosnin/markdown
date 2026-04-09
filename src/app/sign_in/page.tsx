import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/auth/get_request_context";
import { SignInForm } from "./sign_in_form";

export const metadata = {
  title: "Sign in — Context Store",
};

/**
 * Sign in page.
 *
 * Server component: redirects authenticated users away to /app so
 * they never see the sign-in screen while already signed in.
 * The form itself is a Client Component to support action state.
 *
 * The `error` search param is set by /auth/callback if the code
 * exchange fails, giving the user a clear re-entry point.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { isAuthenticated } = await getRequestContext();

  if (isAuthenticated) {
    redirect("/app");
  }

  const { error } = await searchParams;
  const callbackError = error === "auth_callback_failed";

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo mark */}
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground">
            <div className="h-5 w-5 rounded-sm bg-background" />
          </div>
        </div>

        {/* Header */}
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Sign in to Context Store
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your email to receive a sign-in link.
          </p>
        </div>

        {/* Callback error banner */}
        {callbackError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            The sign-in link was invalid or has expired. Request a new one below.
          </div>
        )}

        {/* Form */}
        <SignInForm />
      </div>
    </div>
  );
}
