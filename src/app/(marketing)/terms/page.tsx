import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Terms of Service — Poggle",
  description:
    "Terms and conditions for using the Poggle platform.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Terms of Service"
        description="Last updated: April 2026"
      />

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Acceptance
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          By accessing or using Poggle, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the service. We may update these terms from time to time, and continued use constitutes acceptance of any changes.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Use License
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          We grant you a limited, non-exclusive, non-transferable license to use Poggle for your personal or business purposes in accordance with these terms. You may not reverse engineer, decompile, or attempt to extract the source code of the service.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          User Content
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          You retain full ownership of all content you create, upload, or store in Poggle. We do not claim any intellectual property rights over your content. You are responsible for ensuring that your content does not violate any applicable laws or third-party rights.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Termination
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          You may terminate your account at any time by contacting support or using the account settings. We reserve the right to suspend or terminate accounts that violate these terms. Upon termination, you may export your data within 30 days before it is permanently deleted.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Limitation of Liability
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          Poggle is provided &ldquo;as is&rdquo; without warranties of any kind, either express or implied. To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the service.
        </p>
      </section>
    </div>
  );
}
