import type { ReactNode } from "react";

/**
 * Shared legal document primitives.
 *
 * These components render the body of a legal document. They are used by both
 * the standalone marketing pages (under /privacy, /terms, etc.) and by the
 * authenticated dashboard's legal modal popups, so the exact same content
 * appears in both contexts.
 *
 * Do NOT inline legal copy in pages. Always import from this file.
 */

export const LEGAL_LAST_UPDATED = "April 12, 2026";
export const LEGAL_EFFECTIVE_DATE = "April 12, 2026";
export const COMPANY_NAME = "Poggle";
export const COMPANY_LEGAL_NAME = "Poggle";
export const CONTACT_EMAIL = "legal@poggle.app";
export const PRIVACY_EMAIL = "privacy@poggle.app";
export const SUPPORT_EMAIL = "support@poggle.app";
export const DMCA_EMAIL = "dmca@poggle.app";
export const ABUSE_EMAIL = "abuse@poggle.app";

export function LegalSection({
  heading,
  children,
  id,
}: {
  heading: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mb-8">
      <h2 className="mb-3 scroll-mt-24 text-base font-semibold text-foreground">
        {heading}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function LegalSubsection({
  heading,
  children,
  id,
}: {
  heading: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-foreground/90">
        {heading}
      </h3>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground/60">
      {children}
    </ul>
  );
}

export function LegalLastUpdated() {
  return (
    <p className="mb-6 text-xs text-muted-foreground/70">
      Last updated: {LEGAL_LAST_UPDATED} &middot; Effective:{" "}
      {LEGAL_EFFECTIVE_DATE}
    </p>
  );
}
