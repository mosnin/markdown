import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { WelcomeClient } from "./welcome_client";
import { WelcomeOnboarding } from "./welcome_onboarding";

/**
 * Post-login welcome screen.
 *
 * `connection()` opts this route out of static prerendering so the proxy's
 * per-request CSP nonce is injected into the framework scripts. Under the
 * strict `script-src 'self' 'nonce-…' 'strict-dynamic'` policy a statically
 * prerendered page ships no nonce, so the browser blocks its hydration JS —
 * which would strand the user on the animation forever (the redirect to /app
 * never runs). See proxy.ts.
 *
 * First sign-in (no `onboarded_at` metadata flag) gets the welcome wizard;
 * returning users get the quick intro animation straight through to /app.
 */
export default async function WelcomePage() {
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const showOnboarding = !!user && !user.user_metadata?.onboarded_at;

  return showOnboarding ? <WelcomeOnboarding /> : <WelcomeClient />;
}
