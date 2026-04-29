import type { Metadata } from "next";
import { PageHeroSection } from "@/components/marketing/hero";
import { RefundContent } from "@/components/legal/refund_content";

export const metadata: Metadata = {
  title: "Refund Policy — Atlas",
  description:
    "When and how refunds are issued for Atlas subscriptions.",
};

export default function RefundPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Legal"
        title="Refund Policy"
        description="Our refund practices explained plainly."
      />
      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <RefundContent />
      </section>
    </div>
  );
}
