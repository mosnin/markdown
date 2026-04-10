import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Pricing — Context Store",
  description:
    "Start free, upgrade when you're ready. Simple, transparent pricing for individuals and teams.",
};

const PLANS = [
  {
    name: "Free",
    price: { monthly: "$0", annual: "$0" },
    period: "forever",
    description: "For individuals getting started with structured knowledge.",
    cta: "Get started free",
    href: "/sign_in",
    highlight: false,
    features: [
      "100 notes",
      "3 boxes",
      "Full markdown editor",
      "Basic context export",
      "7-day version history",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: { monthly: "$12", annual: "$9" },
    period: "per month",
    description: "For power users who need unlimited knowledge and AI context.",
    cta: "Start 14-day trial",
    href: "/sign_in",
    highlight: true,
    features: [
      "Unlimited notes",
      "Unlimited boxes",
      "AI context bundles",
      "Token-aware packing",
      "Full version history",
      "Diff viewer & rollback",
      "REST API access",
      "Priority support",
    ],
  },
  {
    name: "Team",
    price: { monthly: "$39", annual: "$29" },
    period: "per month",
    description: "For teams that share context and build on each other's knowledge.",
    cta: "Contact sales",
    href: "/contact",
    highlight: false,
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
    a: "Any markdown document you create in Context Store. Attachments, images, and imported files each count as one note.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel any time from your account settings. You'll keep access until the end of your billing period and can export all your data.",
  },
  {
    q: "Do you offer student or nonprofit discounts?",
    a: "Yes — email us at hello@contextstore.app with verification and we'll set you up with 50% off Pro.",
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
      <section className="py-16">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-5 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-xl border p-6 ${
                  plan.highlight
                    ? "border-violet-500/50 bg-card shadow-lg shadow-violet-500/10"
                    : "border-border/60 bg-card"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white">
                      Most popular
                    </span>
                  </div>
                )}
                <p className="font-semibold text-foreground">{plan.name}</p>
                <p className="mt-3">
                  <span className="text-4xl font-bold tracking-tight text-foreground">
                    {plan.price.monthly}
                  </span>
                  {plan.price.monthly !== "$0" && (
                    <span className="ml-1.5 text-sm text-muted-foreground">
                      {plan.period}
                    </span>
                  )}
                </p>
                {plan.price.monthly !== "$0" && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {plan.price.annual}/mo billed annually
                  </p>
                )}
                <p className="mt-3 text-sm text-muted-foreground">
                  {plan.description}
                </p>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                    plan.highlight
                      ? "bg-violet-600 text-white hover:bg-violet-500"
                      : "border border-border bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
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
