import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  PenLine,
  FolderTree,
  GitBranch,
  Send,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "How It Works — Poggle",
  description:
    "From notes to AI-ready context in four steps. Write, organize, connect, and deliver.",
};

const steps = [
  {
    number: 1,
    title: "Write",
    description: "Create markdown notes and code files in focused boxes.",
    icon: PenLine,
  },
  {
    number: 2,
    title: "Organize",
    description:
      "Use folders, skills, and agents to give your content real structure.",
    icon: FolderTree,
  },
  {
    number: 3,
    title: "Connect",
    description:
      "Link objects with semantic relationships. See the big picture in the graph.",
    icon: GitBranch,
  },
  {
    number: 4,
    title: "Deliver",
    description: "Export bundles, use the API, or connect AI agents via MCP.",
    icon: Send,
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="How It Works"
        title="From notes to AI-ready context in four steps"
        description="See how Poggle fits into your workflow."
        ctaPrimary={{ label: "Get started free", href: "/sign_in" }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <Card key={step.number}>
              <CardHeader>
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                  <step.icon className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <p className="text-overline text-brand">Step {step.number}</p>
                <CardTitle>{step.title}</CardTitle>
                <CardDescription>{step.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-headline text-foreground">
            Ready to get started?
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Go from zero to structured context in minutes. No credit card
            needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Button>
            <ul className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              {[
                "Free plan forever",
                "Import from Obsidian",
                "No vendor lock-in",
              ].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
