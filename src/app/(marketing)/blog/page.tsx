import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Code2,
  Download,
  GitPullRequestArrow,
  Plug,
  Puzzle,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { MatrixCta } from "@/components/marketing/matrix_cta";

export const metadata: Metadata = {
  title: "Blog — Poggle",
  description: "Notes on context engineering, governed agents, and building the trust gate.",
};

const TOPICS = [
  { icon: GitPullRequestArrow, title: "The trust-gate pattern", body: "Why propose-then-approve beats giving agents write access.", href: "/how-it-works" },
  { icon: Plug, title: "Scoping agents with MCP", body: "Least-privilege access for AI, via a protocol you already have.", href: "/connections" },
  { icon: Boxes, title: "Branches for knowledge", body: "Borrowing git's best idea for the things you can't diff in code.", href: "/organization" },
  { icon: Puzzle, title: "Skills & orchestration", body: "Keeping agent context lean as the work gets deep.", href: "/skills-and-agents" },
  { icon: Download, title: "Portability is trust", body: "Why we make leaving easy — and why that keeps you.", href: "/portability" },
  { icon: Code2, title: "Building on the layer", body: "Patterns for integrating Poggle into your own stack.", href: "/api" },
];

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Blog"
        title="Notes on context engineering."
        description="How we think about governed agents, the trust gate, and giving AI the right context — not just more of it. Long-form dispatches are on the way; here's what we're writing about."
      />

      <MarketingSection className="border-b border-border/30">
        <SectionHeader eyebrow="What we write about" title="The ideas behind Poggle." />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {TOPICS.map((t) => {
            const Icon = t.icon;
            return (
              <Link key={t.title} href={t.href} className="group">
                <BentoCard className="h-full">
                  <IconTile>
                    <Icon className="size-5" aria-hidden="true" />
                  </IconTile>
                  <h3 className="mt-5 flex items-center gap-1.5 font-hero text-lg font-semibold text-foreground">
                    {t.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-500">
                    Read more
                    <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </BentoCard>
              </Link>
            );
          })}
        </div>
      </MarketingSection>

      <MatrixCta
        title="Dispatches, when they land."
        subtitle="The fastest way to follow along is to use it. Start free, and the product itself is the best dispatch we publish."
        primary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
      />
    </div>
  );
}
