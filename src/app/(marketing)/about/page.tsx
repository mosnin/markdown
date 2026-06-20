import type { Metadata } from "next";
import { Compass, GitPullRequestArrow, LockOpen, ShieldCheck } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { MatrixCta } from "@/components/marketing/matrix_cta";

export const metadata: Metadata = {
  title: "About — Poggle",
  description:
    "Poggle is the governed context layer for AI agents — a trust gate between your agents and your source of truth. Here's why we're building it.",
};

const PRINCIPLES = [
  {
    icon: GitPullRequestArrow,
    title: "A human stays in the loop",
    body: "Agents are extraordinary at proposing. Humans are irreplaceable at deciding. We design for that division of labor, not around it.",
  },
  {
    icon: ShieldCheck,
    title: "Governance by construction",
    body: "Safety shouldn't be a setting you can forget to enable. The trust gate is structural — agents can't write, only propose.",
  },
  {
    icon: LockOpen,
    title: "Open and portable",
    body: "Plain markdown, open formats, export anytime. We earn your trust by making it easy to leave — so you won't want to.",
  },
  {
    icon: Compass,
    title: "Boring where it counts",
    body: "Audit logs, version history, scoped tokens. The unglamorous parts are exactly the parts an enterprise has to be able to rely on.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="About"
        title="We're building the trust layer for AI agents."
        description="Agents are getting good enough to change your source of truth. The question is no longer whether they can — it's whether they should, and who decides. Poggle is our answer."
      />

      {/* Narrative */}
      <MarketingSection className="border-b border-border/30">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeader
            eyebrow="Why we exist"
            title="Context is the bottleneck. Trust is the risk."
            lede="Teams are racing to give AI agents access to their knowledge. The ones who win won't be the ones who gave agents the most access — they'll be the ones who gave them the right access, with a human holding the gate."
          />
          <BentoCard>
            <p className="text-pretty text-[15px] leading-relaxed text-foreground/85">
              We watched team after team wire an agent straight into their docs,
              then quietly turn it off the first time it confidently rewrote
              something important.
            </p>
            <p className="mt-4 text-pretty text-[15px] leading-relaxed text-foreground/85">
              The fix isn’t a smarter model. It’s a <span className="font-medium text-foreground">trust gate</span> —
              a place where agents read freely, propose changes, and wait for a
              human to approve. That’s the entire idea behind Poggle, and we think
              it’s how serious teams will run agents for years to come.
            </p>
          </BentoCard>
        </div>
      </MarketingSection>

      {/* Principles */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader eyebrow="Principles" title="What we optimize for." />
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {PRINCIPLES.map((p) => {
            const Icon = p.icon;
            return (
              <BentoCard key={p.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </BentoCard>
            );
          })}
        </div>
      </MarketingSection>

      {/* CTA */}
      <MatrixCta
        title="Run agents like you mean it."
        subtitle="Give them context. Keep the gate. Start free."
        primary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
      />
    </div>
  );
}
