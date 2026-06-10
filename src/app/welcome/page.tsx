import { connection } from "next/server";
import { WelcomeClient } from "./welcome_client";

/**
 * Post-login welcome screen.
 *
 * `connection()` opts this route out of static prerendering so the proxy's
 * per-request CSP nonce is injected into the framework scripts. Under the
 * strict `script-src 'self' 'nonce-…' 'strict-dynamic'` policy a statically
 * prerendered page ships no nonce, so the browser blocks its hydration JS —
 * which would strand the user on the animation forever (the redirect to /app
 * never runs). See proxy.ts.
 */
export default async function WelcomePage() {
  await connection();
  return <WelcomeClient />;
}
