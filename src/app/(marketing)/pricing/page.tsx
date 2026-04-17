import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus, CheckCircle2, Users, Briefcase, Building2 } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import * as PricingCard from "@/components/ui/pricing-card";
import { Button } from "@/components/ui/button";

// ─── Static generation ───────────────────────────────────────────────────────
// Pricing page is public content — pre-render at build time and revalidate
// every hour via ISR so pricing changes propagate quickly.
export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pricing — Poggle",
  description:
    "Start free, upgrade when you're ready. Simple, transparent pricing for individuals and teams.",
};

const PLANS = [
  {
    icon: <Users />,
    name: "Free",
    price: "Free",
    period: null as string | null,
    annual: null as string | null,
    badge: null as string | null,
    description: "For individuals getting started with structured knowledge.",
    cta: "Get started free",
    href: "/sign_in",
    variant: "outline" as const,
    features: [
      "100 notes & files",
      "3 boxes",
      "Skills & agents",
      "Tree & graph views",
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
    description: "For power users who need unlimited knowledge and AI context.",
    cta: "Start 14-day trial",
    href: "/sign_in",
    variant: "default" as const,
    features: [
      "Unlimited everything",
      "Unlimited boxes",
      "Full graph & tree views",
      "Context bundles",
      "Full version history",
      "Diff viewer & rollback",
      "REST API & MCP access",
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
    description: "For teams that share context and build on each other's knowledge.",
    cta: "Contact sales",
    href: "/contact",
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
    category: "Notes & Organization",
    rows: [
      { feature: "Notes", free: "100", pro: "Unlimited", team: "Unlimited" },
      { feature: "Boxes", free: "3", pro: "Unlimited", team: "Unlimited" },
      { feature: "Bidirectional links", free: true, pro: true, team: true },
      { feature: "Full-text search", free: true, pro: true, team: true },
      { feature: "Import from Obsidian / Notion", free: true, pro: true, team: true },
    ],
  },
  {
    category: "AI & Export",
    rows: [
      { feature: "Basic markdown export", free: true, pro: true, team: true },
      { feature: "AI context bundles", free: false, pro: true, team: true },
      { feature: "Token-aware packing", free: false, pro: true, team: true },
      { feature: "Multi-format export (JSON, text)", free: false, pro: true, team: true },
      { feature: "REST API", free: false, pro: true, team: true },
    ],
  },
  {
    category: "History & Audit",
    rows: [
      { feature: "Version history", free: "7 days", pro: "Unlimited", team: "Unlimited" },
      { feature: "Diff viewer", free: false, pro: true, team: true },
      { feature: "One-click rollback", free: false, pro: true, team: true },
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
    q: "What counts as a note?",
    a: "Any markdown document you create in Poggle. Attachments, images, and imported files each count as one note.",
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
    a: "We accept all major credit cards and debit cards via Stripe. Annual plans can also be paid by invoice.",
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true)
    return <Check className="mx-auto h-4 w-4 text-violet-400" />;
  if (value === false)
    return <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" />;
  return <span className="text-sm text-foreground">{value}</span>;
}

export default function PricingPage() {
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
                  <Button
                    variant={plan.variant}
                    className="w-full font-semibold"
                    render={<Link href={plan.href} />}
                  >
                    {plan.cta}
                  </Button>
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
          <h2 className="mb-8 text-xl font-bold tracking-tight text-foreground">
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
                  <>
                    <tr key={section.category}>
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Enterprise */}
      <section className="py-16">
        <div className="mx-auto max-w-5xl px-6">
          <div className="rounded-xl border border-border/60 bg-card p-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
                  Enterprise
                </p>
                <h3 className="mt-1 text-xl font-bold tracking-tight text-foreground">
                  Custom deployment for large teams
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  On-premise hosting, custom SLAs, dedicated onboarding, and
                  volume discounts for 50+ seat deployments.
                </p>
              </div>
              <Link
                href="/contact"
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Talk to sales
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border/50 py-16">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="mb-8 text-xl font-bold tracking-tight text-foreground">
            Pricing FAQ
          </h2>
          <div className="divide-y divide-border/60">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
                  {faq.q}
                  <span className="shrink-0 text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
