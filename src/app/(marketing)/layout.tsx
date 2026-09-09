import { connection } from "next/server";

/**
 * The logged-out route group.
 *
 * Deliberately thin: every page renders its own `MarketingShell`, which owns
 * the header, the skip link and the footer. The only thing this layout does is
 * opt the section out of static prerendering, so the proxy's per-request CSP
 * nonce reaches the framework scripts — under `script-src 'nonce-…'
 * 'strict-dynamic'`, a statically prerendered page ships no nonce and the
 * browser blocks its hydration JS. See proxy.ts.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  return <>{children}</>;
}
