import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { MarketingSection, BentoCard } from "@/components/marketing/sections";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Changelog — Poggle",
  description: "What's new in Poggle — the governed context layer for AI agents.",
};

type Entry = {
  date: string;
  tag: string;
  title: string;
  points: string[];
};

const ENTRIES: Entry[] = [
  {
    date: "June 2026",
    tag: "Trust gate",
    title: "Approve every agent write, end to end",
    points: [
      "Proposals: agents submit reviewable diffs instead of writing directly.",
      "Review inbox with approve, edit, and reject — and one-click rollback.",
      "Append-only audit log across connect, read, propose, and approve.",
    ],
  },
  {
    date: "June 2026",
    tag: "Connections",
    title: "Connect any MCP agent with scoped tokens",
    points: [
      "OAuth 2.1 + PKCE authorization for any MCP-capable client.",
      "Per-box, per-capability scopes enforced at the protocol layer.",
      "Token rotation and instant revocation, with the refresh family revoked too.",
    ],
  },
  {
    date: "May 2026",
    tag: "Agents",
    title: "Skills, sub-agents, and workflows",
    points: [
      "Package reusable skills your agents can call.",
      "Sub-agents run in fresh context windows to keep orchestration lean.",
      "Compose multi-step workflows with branches and merges.",
    ],
  },
  {
    date: "May 2026",
    tag: "Knowledge",
    title: "Boxes, branches, and the knowledge graph",
    points: [
      "Organize knowledge into boxes and nested folders.",
      "Agents draft on isolated branches, promoted to main only by a human.",
      "A living graph of notes, entities, and links for precise retrieval.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Changelog"
        title="What's shipping."
        description="A running log of what we've built. Every entry is the trust gate getting a little more capable — and a little more trustworthy."
      />

      <MarketingSection className="border-b border-border/30">
        <ol className="relative mx-auto max-w-3xl list-none border-l border-border/50 pl-6 sm:pl-8">
          {ENTRIES.map((e) => (
            <li key={e.title} className="relative pb-12 last:pb-0">
              <span className="absolute -left-[1.7rem] top-1.5 size-3 rounded-full border-2 border-background bg-violet-500 sm:-left-[2.2rem]" />
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60">
                  {e.date}
                </span>
                <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-500">
                  {e.tag}
                </span>
              </div>
              <h2 className="mt-2 font-hero text-xl font-bold tracking-tight text-foreground">
                {e.title}
              </h2>
              <ul className="mt-3 list-none space-y-2">
                {e.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[14px] leading-relaxed text-muted-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-violet-500/50" />
                    {p}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </MarketingSection>

      <MarketingSection>
        <BentoCard tone="gradient" className="px-6 py-14 text-center sm:px-12 sm:py-16">
          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-hero text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Want it before it’s in the changelog?
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-base text-white/80">
              Start free and you’re always on the latest.
            </p>
            <div className="mt-7 flex justify-center">
              <Button
                size="lg"
                className="rounded-full bg-white text-violet-700 hover:bg-white/90"
                render={<Link href="/sign_in?mode=signup" />}
              >
                Get started free
                <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </BentoCard>
      </MarketingSection>
    </div>
  );
}
