import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";
import { DMCAContent } from "@/components/legal/dmca_content";

export const metadata: Metadata = {
  title: "DMCA Policy — Poggle",
  description:
    "How to submit copyright infringement notices and counter-notices.",
};

export default function DMCAPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="DMCA Policy"
        description="How we handle copyright complaints and counter-notices."
      />
      <section className="page-content py-16">
        <DMCAContent />
      </section>
    </div>
  );
}
