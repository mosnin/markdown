import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Blog — Poggle",
  description:
    "Articles, guides, and updates from the Poggle team.",
};

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Blog"
        title="Blog"
        description="Articles, guides, and updates from the Poggle team."
      />

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Coming soon
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground mb-6">
            We&apos;re working on our first posts. In the meantime, check the changelog for the latest updates.
          </p>
          <Button size="lg" render={<Link href="/changelog" />}>View changelog
            <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </section>
    </div>
  );
}
