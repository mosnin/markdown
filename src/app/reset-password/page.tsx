import { connection } from "next/server";
import Link from "next/link";
import { ResetPasswordForm } from "./reset_password_form";

export const metadata = {
  title: "Reset password — Poggle",
};

/**
 * /reset-password
 *
 * Landing page after the user clicks the Supabase password-reset link in their
 * email. The auth callback route (/auth/callback) exchanges the code for a
 * session and redirects here. The user is authenticated at this point but only
 * in the "recovery" token scope — they must set a new password to get full
 * access.
 */
export default async function ResetPasswordPage() {
  // Opt out of static prerendering so the proxy's per-request CSP nonce is
  // injected into the framework scripts; otherwise the strict nonce +
  // 'strict-dynamic' policy blocks this client form's JS in production and the
  // "set new password" submit never runs. See proxy.ts.
  await connection();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex justify-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
              <div className="h-3 w-3 rounded-sm bg-background" />
            </div>
            <span className="font-display text-sm font-semibold text-foreground">Poggle</span>
          </Link>
        </div>

        {/* Heading */}
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Set new password
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose a strong password for your account.
          </p>
        </div>

        <ResetPasswordForm />

        <p className="text-center text-xs text-muted-foreground">
          Changed your mind?{" "}
          <Link href="/sign_in" className="font-medium text-foreground underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
