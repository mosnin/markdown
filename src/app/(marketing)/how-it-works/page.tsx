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

export const metadata: Metadata = {
  title: "How It Works — Poggle",
  description:
    "From notes to AI-ready context in four steps. Write, organize, connect, and deliver.",
};

const steps = [
  {
    number: 1,
    title: "Write",
    description:
      "Create markdown notes and code files in focused boxes.",
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
    description:
      "Export bundles, use the API, or connect AI agents via MCP.",
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

      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="rounded-xl border border-border/50 bg-card p-6"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <step.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-violet-400">
                Step {step.number}
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to get started?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Go from zero to structured context in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>Get started free
              <ArrowRight className="h-4 w-4" /></Button>
            <ul className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              {[
                "Free plan forever",
                "Import from Obsidian",
                "No vendor lock-in",
              ].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-violet-400" />
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
