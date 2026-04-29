import type { Metadata } from "next";
import {
  BookOpen,
  HelpCircle,
  Mail,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Help Center — Atlas",
  description:
    "Get help with Atlas. Guides, common questions, and contact support.",
};

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Support"
        title="Help Center"
        description="Find answers, learn the basics, or get in touch."
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Getting Started</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Create your first box, write a note, and explore the sidebar tree. Visit our docs at docs.atlas.app for step-by-step guides.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Common Questions</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Can I import from Obsidian? Yes. Is my data portable? Always. Do you train AI on my content? Never. Check our docs for more FAQs.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Contact Support</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Need help with something specific? Reach out to us at{" "}
              <a
                href="mailto:support@atlas.app"
                className="font-medium text-foreground underline underline-offset-4 hover:text-violet-400"
              >
                support@atlas.app
              </a>
              . We respond within one business day.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
