import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Privacy Policy — Poggle",
  description:
    "How Poggle collects, uses, and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Privacy Policy"
        description="Last updated: April 2026"
      />

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Information We Collect
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          We collect information you provide directly when you create an account, including your name, email address, and payment information. We also collect usage data such as pages visited, features used, and interaction patterns to improve the service.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          How We Use It
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          We use your information to provide, maintain, and improve Poggle. This includes authenticating your identity, processing payments, sending service-related communications, and analyzing usage patterns to enhance our product. We do not sell your personal information to third parties.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Data Storage
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          Your data is stored securely on encrypted servers. We use industry-standard security measures to protect your information from unauthorized access, alteration, or destruction. Your notes, files, and workspace content remain yours — we do not use your content to train AI models.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Your Rights
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          You have the right to access, correct, or delete your personal information at any time. You can export all of your data using our export tools. If you delete your account, we will remove your personal information and content within 30 days.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Contact
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          If you have questions about this privacy policy or your personal data, please contact us at privacy@poggle.app.
        </p>
      </section>
    </div>
  );
}
