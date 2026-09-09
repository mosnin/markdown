import type { ReactNode } from "react";
import { CutButton } from "@/components/marketing/cut-button";
import { Container, Section, SectionHeading } from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";
import { cn } from "@/lib/utils";

const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "forever",
    lead: "For one developer running a couple of agents.",
    features: [
      "1 project",
      "3 relay keys",
      "7 days of session history",
      "Handoff briefs and search",
      "Claude Code, Codex, git and CLI hooks",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$12",
    cadence: "per developer / month",
    lead: "For someone running several agents across several plans.",
    features: [
      "Unlimited projects",
      "Unlimited relay keys",
      "90 days of session history",
      "Full conversation capture and semantic search",
      "Live multi-agent coordination and claims",
      "Outbound webhooks",
    ],
    cta: "Start free",
    featured: true,
  },
  {
    id: "team",
    name: "Team",
    price: "$39",
    cadence: "per developer / month",
    lead: "For a team whose agents work on the same repositories.",
    features: [
      "Everything in Pro",
      "Shared workspace and roles",
      "Unlimited history",
      "SSO / SAML",
      "Audit log and export",
      "Priority support",
    ],
    cta: "Start free",
    featured: false,
  },
];

export function PricingPage(): ReactNode {
  return (
    <MarketingShell>
      <Section labelledBy="pricing-heading">
        <Container>
          <SectionHeading
            id="pricing-heading"
            align="center"
            kicker="Pricing"
            title="Free while you try it."
            lead="Every plan captures context the same way. The paid tiers differ in how much history you keep and how many people share it."
          />

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {TIERS.map((tier) => (
              <div
                key={tier.id}
                className={cn(
                  "flex flex-col gap-6 rounded-12 border bg-raised p-8",
                  tier.featured
                    ? "border-strong"
                    : "border-hairline",
                )}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="t-mk-h4 text-ink">{tier.name}</h2>
                    {tier.featured ? (
                      <span className="t-label-caps rounded-full bg-inset px-3 py-1 text-ink-2">
                        Most common
                      </span>
                    ) : null}
                  </div>
                  <p className="t-mk-body text-ink-2">{tier.lead}</p>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="t-mk-h2 text-ink">{tier.price}</span>
                  <span className="t-mk-ill-12 text-ink-3">{tier.cadence}</span>
                </div>

                <ul className="flex flex-1 flex-col gap-3 border-t border-hairline pt-6">
                  {tier.features.map((f) => (
                    <li key={f} className="t-mk-ill-13 text-ink-2">
                      {f}
                    </li>
                  ))}
                </ul>

                <CutButton
                  href="/sign_in"
                  variant={tier.featured ? "solid" : "outline"}
                >
                  {tier.cta}
                </CutButton>
              </div>
            ))}
          </div>

          <p className="t-mk-ill-12 mt-10 text-center text-ink-3">
            Self-hosting is possible — the relay is a Next.js app and a Postgres
            database. Bring your own keys and your data never leaves.
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
