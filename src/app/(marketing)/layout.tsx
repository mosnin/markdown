import { connection } from "next/server";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Opt the whole marketing section out of static prerendering so the proxy's
  // per-request CSP nonce reaches the framework scripts. Under the strict
  // `script-src 'nonce-…' 'strict-dynamic'` policy, statically prerendered
  // pages ship no nonce and the browser blocks their hydration JS (theme
  // toggle, mobile nav, etc.). The home and pricing pages already do this via
  // their own `connection()` call; hoisting it here covers the rest. See proxy.ts.
  await connection();

  return (
    <>
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </>
  );
}
