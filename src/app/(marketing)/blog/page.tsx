import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";

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
          <Link
            href="/changelog"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
          >
            View changelog
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
