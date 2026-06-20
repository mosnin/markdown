import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitPullRequestArrow, ScrollText, SlidersHorizontal } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { LoopStepper } from "@/components/marketing/loop_stepper";
import { ArchitectureDiagram } from "@/components/marketing/architecture_diagram";
import { TerminalShowcase } from "@/components/marketing/terminal_showcase";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How It Works — Poggle",
  description:
    "The governed loop in four steps: agents connect over MCP, read your context, propose changes, and you approve.",
};

const WHY = [
  {
    icon: GitPullRequestArrow,
    title: "Proposals, not writes",
    body: "Agents submit reviewable diffs. You see exactly what would change, in context, before anything happens.",
  },
  {
    icon: SlidersHorizontal,
    title: "Scoped, least-privilege access",
    body: "Each agent gets a token scoped to specific boxes and capabilities — read here, propose there, nothing more.",
  },
  {
    icon: ScrollText,
    title: "Auditable and reversible",
    body: "Every step lands on an append-only log, with full version history and one-click rollback on every object.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="How it works"
        title="The governed loop, in four steps."
        description="Agents connect, read, and propose. You approve. Here's the trust gate, end to end — try it below."
        ctaPrimary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "Connect an agent", href: "/connections" }}
      />

      {/* Interactive loop */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="The loop"
          title="One path, every agent, every time."
          lede="Click through each step, or let it play. The gate stays closed until a human opens it."
        />
        <LoopStepper />
      </MarketingSection>

      {/* Live terminal */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="Live"
          title="Watch the loop run."
          lede="Connect, read, propose, approve — the same gate, in your terminal. Click a step to replay it."
        />
        <div className="mt-12">
          <TerminalShowcase />
        </div>
      </MarketingSection>

      {/* Why it's safe */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader eyebrow="Why it's safe" title="Guardrails that aren't optional." />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {WHY.map((w) => {
            const Icon = w.icon;
            return (
              <BentoCard key={w.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">{w.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{w.body}</p>
              </BentoCard>
            );
          })}
        </div>
      </MarketingSection>

      {/* Architecture */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="Architecture"
          title="From any agent to your source of truth."
          lede="Agents connect over MCP and propose changes. Nothing is written to your governed store until you approve — and every step is versioned and audited."
        />
        <div className="mt-12">
          <ArchitectureDiagram />
        </div>
      </MarketingSection>

      {/* CTA */}
      <MarketingSection>
        <BentoCard tone="gradient" className="px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -left-10 -top-10 size-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-hero text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to put a human in the loop?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/80 sm:text-lg">
              Connect your first agent in minutes. No credit card needed.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="rounded-full bg-white text-violet-700 hover:bg-white/90"
                render={<Link href="/sign_in?mode=signup" />}
              >
                Get started free
                <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="rounded-full text-white hover:bg-white/10 hover:text-white"
                render={<Link href="/pricing" />}
              >
                View pricing
              </Button>
            </div>
          </div>
        </BentoCard>
      </MarketingSection>
    </div>
  );
}
