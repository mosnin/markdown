import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";
import { PrivacyContent } from "@/components/legal/privacy_content";

export const metadata: Metadata = {
  title: "Privacy Policy — Atlas",
  description:
    "How Atlas collects, uses, and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Privacy Policy"
        description="We respect your data. Read how we collect, use, and protect it."
      />
      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <PrivacyContent />
      </section>
    </div>
  );
}
