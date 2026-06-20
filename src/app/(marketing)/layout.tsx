import { connection } from "next/server";
import { AnnouncementBar } from "@/components/marketing/announcement_bar";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { LightBoard } from "@/components/ui/lightboard";

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
      <AnnouncementBar />
      <MarketingHeader />
      <main>{children}</main>
      {/* Lightboard marquee above the footer */}
      <section
        aria-hidden="true"
        className="overflow-hidden border-t border-border/40 bg-background px-6 py-8"
      >
        <div className="mx-auto max-w-6xl">
          <LightBoard
            text="POGGLE   GOVERNED CONTEXT FOR AI AGENTS   "
            rows={9}
            lightSize={6}
            gap={2}
            colors={{
              textBright: "rgba(167,139,250,0.95)",
              drawLine: "rgba(167,139,250,0.55)",
              textDim: "rgba(130,120,170,0.45)",
              background: "rgba(130,120,170,0.10)",
            }}
          />
        </div>
      </section>
      <MarketingFooter />
    </>
  );
}
