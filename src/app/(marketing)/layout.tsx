import { connection } from "next/server";
import AnnouncementRibbon from "@/components/animata/container/announcement-ribbon";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { LightBoard } from "@/components/ui/lightboard";
import { MatrixRain } from "@/components/ui/matrix-rain";

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
      <AnnouncementRibbon />
      <MarketingHeader />
      <main>{children}</main>
      {/* Blue matrix-rain band above the footer */}
      <section
        aria-hidden="true"
        className="relative h-56 w-full overflow-hidden border-t border-border/40"
      >
        <MatrixRain fixedColor="#38bdf8" fontSize={16} speed={55} className="opacity-80" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
      </section>
      {/* Lightboard marquee above the footer — full-bleed, slow blue crawl */}
      <section
        aria-hidden="true"
        className="overflow-hidden border-t border-border/40 bg-background py-8"
      >
        <LightBoard
          text="POGGLE   GOVERNED CONTEXT FOR AI AGENTS   "
          rows={9}
          lightSize={6}
          gap={2}
          updateInterval={120}
          colors={{
            textBright: "rgba(56,189,248,0.95)",
            drawLine: "rgba(56,189,248,0.5)",
            textDim: "rgba(14,165,233,0.4)",
            background: "rgba(56,189,248,0.08)",
          }}
        />
      </section>
      <MarketingFooter />
    </>
  );
}
