import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Plug,
  BookOpen,
  GitPullRequestArrow,
  ShieldCheck,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How It Works — Poggle",
  description:
    "The governed loop in four steps: agents connect over MCP, read your context, propose changes, and you approve.",
};

const steps = [
  {
    number: 1,
    title: "Connect over MCP",
    description:
      "Atlas AI and any MCP-capable agent connect to your workspace with a scoped token.",
    icon: Plug,
  },
  {
    number: 2,
    title: "Read your context",
    description:
      "Agents read the notes, files, and decisions you grant them — your live source of truth.",
    icon: BookOpen,
  },
  {
    number: 3,
    title: "Propose changes",
    description:
      "Agents never write directly. Every change arrives as a reviewable diff against your workspace.",
    icon: GitPullRequestArrow,
  },
  {
    number: 4,
    title: "You approve",
    description:
      "A human reviews and approves before anything lands. The trust gate stays closed until you open it.",
    icon: ShieldCheck,
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="How It Works"
        title="The governed loop, in four steps"
        description="Agents connect, read, and propose. You approve. Here's how the trust gate works."
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
            Connect your first agent in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>Get started free
              <ArrowRight className="h-4 w-4" /></Button>
            <ul className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              {[
                "Free plan forever",
                "Human-in-the-loop by default",
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
