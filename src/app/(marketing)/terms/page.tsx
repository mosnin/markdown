import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";
import { TermsContent } from "@/components/legal/terms_content";

export const metadata: Metadata = {
  title: "Terms of Service — Poggle",
  description:
    "The rules and commitments that govern your use of Poggle.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Terms of Service"
        description="Please read these terms carefully. They form a binding agreement between you and Poggle."
      />
      <section className="page-content py-16">
        <TermsContent />
      </section>
    </div>
  );
}
