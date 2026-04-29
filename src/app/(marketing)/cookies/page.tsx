import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";
import { CookieContent } from "@/components/legal/cookie_content";

export const metadata: Metadata = {
  title: "Cookie Policy — Atlas",
  description:
    "How Atlas uses cookies and similar technologies.",
};

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Cookie Policy"
        description="How we use cookies and similar technologies."
      />
      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <CookieContent />
      </section>
    </div>
  );
}
