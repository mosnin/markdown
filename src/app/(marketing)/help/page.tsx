import type { Metadata } from "next";
import { BookOpen, HelpCircle, Mail } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Help Center — Poggle",
  description:
    "Get help with Poggle. Guides, common questions, and contact support.",
};

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Support"
        title="Help Center"
        description="Find answers, learn the basics, or get in touch."
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                <BookOpen className="h-4.5 w-4.5 text-muted-foreground" />
              </div>
              <CardTitle>Getting started</CardTitle>
              <CardDescription>
                Create your first box, write a note, and explore the sidebar
                tree. Visit our docs at docs.poggle.app for step-by-step guides.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                <HelpCircle className="h-4.5 w-4.5 text-muted-foreground" />
              </div>
              <CardTitle>Common questions</CardTitle>
              <CardDescription>
                Can I import from Obsidian? Yes. Is my data portable? Always. Do
                you train AI on my content? Never. Check our docs for more FAQs.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                <Mail className="h-4.5 w-4.5 text-muted-foreground" />
              </div>
              <CardTitle>Contact support</CardTitle>
              <CardDescription>
                Need help with something specific? Reach out to us at{" "}
                <a
                  href="mailto:support@poggle.app"
                  className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
                >
                  support@poggle.app
                </a>
                . We respond within one business day.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>
    </div>
  );
}
