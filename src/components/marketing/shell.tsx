import type { ReactNode } from "react";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";

/**
 * The logged-out chassis. `company-marketing` scopes the marketing tokens and
 * type roles (app/marketing.css); the header is fixed, so the main column
 * starts below it.
 */
export function MarketingShell({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div className="company-marketing">
      <a
        href="#main-content"
        className="t-caption-medium focus-ring-canvas sr-only rounded-8 border border-strong bg-raised px-4 text-ink outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:inline-flex focus:h-9 focus:items-center"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="pt-[88px] outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
