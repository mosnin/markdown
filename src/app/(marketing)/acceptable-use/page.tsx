import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";
import { AcceptableUseContent } from "@/components/legal/aup_content";

export const metadata: Metadata = {
  title: "Acceptable Use Policy — Atlas",
  description:
    "Prohibited uses of the Atlas service.",
};

export default function AcceptableUsePage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Acceptable Use Policy"
        description="What you can and cannot do with Atlas."
      />
      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <AcceptableUseContent />
      </section>
    </div>
  );
}
