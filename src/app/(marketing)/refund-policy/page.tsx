import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Refund Policy — Poggle",
  description:
    "Our refund policy: 14-day trial, cancel anytime, prorated refunds for annual plans.",
};

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Refund Policy"
        description="Last updated: April 2026"
      />

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Free Trial
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          All paid plans include a 14-day free trial. During the trial period, you have full access to all features. If you cancel before the trial ends, you will not be charged.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Monthly Plans
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          Monthly subscriptions can be cancelled at any time. When you cancel, you retain access until the end of your current billing period. We do not offer partial refunds for unused time on monthly plans.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Annual Plans
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          Annual subscriptions are eligible for a prorated refund within the first 30 days of purchase. After 30 days, you may cancel but will retain access until the end of your annual billing period without a refund.
        </p>

        <h2 className="text-lg font-semibold text-foreground mb-4">
          Contact Support
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">
          If you have questions about billing or need to request a refund, please contact us at support@poggle.app. We aim to respond to all refund requests within 2 business days.
        </p>
      </section>
    </div>
  );
}
