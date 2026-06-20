import { connection } from "next/server";
import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus, CheckCircle2, Users, Briefcase, Building2 } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { UpgradeButton } from "@/components/marketing/upgrade_button";
import { Faq } from "@/components/marketing/faq";
import { MarketingSection, SectionHeader } from "@/components/marketing/sections";
import { MatrixCta } from "@/components/marketing/matrix_cta";
import * as PricingCard from "@/components/ui/pricing-card";
import { Button } from "@/components/ui/button";

const SALES_MAILTO = "mailto:hello@poggle.app?subject=Poggle%20Team%20plan";

export const metadata: Metadata = {
  title: "Pricing — Poggle",
  description:
    "Start free, upgrade when you're ready. Simple, transparent pricing for governing AI agents on your context.",
};

const PLANS = [
  {
    icon: <Users />,
    name: "Free",
    price: "Free",
    period: null as string | null,
    annual: null as string | null,
    badge: null as string | null,
    description: "For trying the trust gate with your first agent.",
    cta: "Get started free",
    href: "/sign_in",
    variant: "outline" as const,
    features: [
      "1 agent connection",
      "3 boxes",
      "MCP read access",
      "Proposal review & approval",
      "7-day version history",
      "Community support",
    ],
  },
  {
    icon: <Briefcase />,
    name: "Pro",
    price: "$12",
    period: "/month",
    annual: "$9",
    badge: "Popular",
    description: "For teams running agents on real context.",
    cta: "Start 14-day trial",
    href: "/sign_in",
    variant: "default" as const,
    features: [
      "Unlimited agents & boxes",
      "Scoped MCP access",
      "Proposal review & approval",
      "Full version history",
      "Diff viewer & rollback",
      "Append-only audit log",
      "Priority support",
    ],
  },
  {
    icon: <Building2 />,
    name: "Team",
    price: "$39",
    period: "/month",
    annual: "$29",
    badge: null as string | null,
    description: "Shared, governed context for the whole org.",
    cta: "Contact sales",
    href: SALES_MAILTO,
    variant: "outline" as const,
    features: [
      "Everything in Pro",
      "Shared workspaces",
      "Team audit log",
      "SSO / SAML",
      "Admin dashboard",
      "Custom integrations",
      "Dedicated support",
      "SLA guarantee",
    ],
  },
];

const COMPARISON = [
  {
    category: "Agents & Context",
    rows: [
      { feature: "Agent connections", free: "1", pro: "Unlimited", team: "Unlimited" },
      { feature: "Boxes", free: "3", pro: "Unlimited", team: "Unlimited" },
      { feature: "MCP read access", free: true, pro: true, team: true },
      { feature: "Scoped agent permissions", free: false, pro: true, team: true },
      { feature: "Full-text search", free: true, pro: true, team: true },
    ],
  },
  {
    category: "Trust Gate",
    rows: [
      { feature: "Proposal review & approval", free: true, pro: true, team: true },
      { feature: "Diff viewer", free: false, pro: true, team: true },
      { feature: "One-click rollback", free: false, pro: true, team: true },
      { feature: "Markdown export", free: true, pro: true, team: true },
    ],
  },
  {
    category: "History & Audit",
    rows: [
      { feature: "Version history", free: "7 days", pro: "Unlimited", team: "Unlimited" },
      { feature: "Append-only audit log", free: false, pro: true, team: true },
      { feature: "Full audit log", free: false, pro: false, team: true },
    ],
  },
  {
    category: "Team & Admin",
    rows: [
      { feature: "Shared workspaces", free: false, pro: false, team: true },
      { feature: "SSO / SAML", free: false, pro: false, team: true },
      { feature: "Admin dashboard", free: false, pro: false, team: true },
      { feature: "SLA guarantee", free: false, pro: false, team: true },
    ],
  },
];

const FAQS = [
  {
    q: "Is the free plan really free forever?",
    a: "Yes. The free plan has no time limit. You'll never be forced to upgrade. We only ask you to pay when you need features beyond the free tier.",
  },
  {
    q: "How do agents connect?",
    a: "Agents connect over MCP with a scoped token. They get read access to the context you grant and can submit proposals — but they can never write to your workspace directly.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel any time from your account settings. You'll keep access until the end of your billing period and can export all your data.",
  },
  {
    q: "Do you offer student or nonprofit discounts?",
    a: "Yes — email us at hello@poggle.app with verification and we'll set you up with 50% off Pro.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit and debit cards. Annual plans can also be paid by invoice.",
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true)
    return <Check className="mx-auto h-4 w-4 text-violet-400" />;
  if (value === false)
    return <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" />;
  return <span className="text-sm text-foreground">{value}</span>;
}

export default async function PricingPage() {
  await connection();
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <PageHeroSection
        eyebrow="Pricing"
        title="Simple, transparent pricing"
        description="Start free. Upgrade when you need more. No hidden fees."
      />

      {/* Plan cards */}
      <section className="relative overflow-hidden py-16">
        {/* Subtle dotted grid */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.06) 0.8px, transparent 0.8px)',
            backgroundSize: '14px 14px',
            maskImage:
              'radial-gradient(circle at 50% 0%, rgba(0,0,0,1), rgba(0,0,0,0.2) 60%, rgba(0,0,0,0) 90%)',
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6">
          <div className="grid grid-cols-1 gap-6 justify-items-center md:grid-cols-3">
            {PLANS.map((plan) => (
              <PricingCard.Card key={plan.name} className="w-full md:min-w-[260px]">
                <PricingCard.Header>
                  <PricingCard.Plan>
                    <PricingCard.PlanName>
                      {plan.icon}
                      {plan.name}
                    </PricingCard.PlanName>
                    {plan.badge && (
                      <PricingCard.Badge>{plan.badge}</PricingCard.Badge>
                    )}
                  </PricingCard.Plan>
                  <PricingCard.Price>
                    <PricingCard.MainPrice>{plan.price}</PricingCard.MainPrice>
                    {plan.period && (
                      <PricingCard.Period>{plan.period}</PricingCard.Period>
                    )}
                  </PricingCard.Price>
                  {plan.annual && (
                    <p className="mb-3 -mt-1 text-xs text-muted-foreground">
                      or {plan.annual}/mo billed annually
                    </p>
                  )}
                  {plan.name === "Pro" ? (
                    <UpgradeButton>{plan.cta}</UpgradeButton>
                  ) : plan.href.startsWith("mailto:") ? (
                    <Button
                      variant={plan.variant}
                      className="w-full font-semibold"
                      render={<a href={plan.href} />}
                    >
                      {plan.cta}
                    </Button>
                  ) : (
                    <Button
                      variant={plan.variant}
                      className="w-full font-semibold"
                      render={<Link href={plan.href} />}
                    >
                      {plan.cta}
                    </Button>
                  )}
                </PricingCard.Header>
                <PricingCard.Body>
                  <PricingCard.Description>
                    {plan.description}
                  </PricingCard.Description>
                  <PricingCard.List>
                    {plan.features.map((feature) => (
                      <PricingCard.ListItem key={feature}>
                        <CheckCircle2
                          className="size-4 shrink-0 text-violet-400"
                          aria-hidden="true"
                        />
                        <span>{feature}</span>
                      </PricingCard.ListItem>
                    ))}
                  </PricingCard.List>
                </PricingCard.Body>
              </PricingCard.Card>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            All paid plans include a 14-day free trial. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-y border-border/50 bg-muted/10 py-16">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="mb-8 font-hero text-2xl font-bold tracking-tight text-foreground">
            Full comparison
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="pb-3 text-left text-sm font-medium text-muted-foreground">
                    Feature
                  </th>
                  {["Free", "Pro", "Team"].map((p) => (
                    <th
                      key={p}
                      className={`pb-3 text-center text-sm font-semibold ${
                        p === "Pro" ? "text-violet-400" : "text-foreground"
                      }`}
                    >
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((section) => (
                  <Fragment key={section.category}>
                    <tr>
                      <td
                        colSpan={4}
                        className="pb-2 pt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60"
                      >
                        {section.category}
                      </td>
                    </tr>
                    {section.rows.map((row, i) => (
                      <tr
                        key={row.feature}
                        className={`border-b border-border/30 ${
                          i % 2 === 0 ? "" : "bg-muted/20"
                        }`}
                      >
                        <td className="py-2.5 text-sm text-muted-foreground">
                          {row.feature}
                        </td>
                        <td className="py-2.5 text-center">
                          <Cell value={row.free} />
                        </td>
                        <td className="py-2.5 text-center">
                          <Cell value={row.pro} />
                        </td>
                        <td className="py-2.5 text-center">
                          <Cell value={row.team} />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Enterprise */}
      <section className="py-16">
        <div className="mx-auto max-w-5xl px-6">
          <div className="rounded-3xl border border-border/60 bg-card p-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-violet-500">
                  Enterprise
                </p>
                <h3 className="mt-1.5 font-hero text-xl font-bold tracking-tight text-foreground">
                  Custom deployment for large teams
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  On-premise hosting, custom SLAs, dedicated onboarding, and
                  volume discounts for 50+ seat deployments.
                </p>
              </div>
              <a
                href={SALES_MAILTO}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Talk to sales
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <MarketingSection className="border-t border-border/50">
        <div className="mx-auto max-w-3xl">
          <SectionHeader align="center" eyebrow="FAQ" title="Pricing questions." className="mb-10" />
          <Faq items={FAQS} />
        </div>
      </MarketingSection>

      {/* CTA */}
      <MatrixCta
        title="Start free. Govern at scale."
        subtitle="Connect your first agent today — no credit card required."
        primary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
      />
    </div>
  );
}
