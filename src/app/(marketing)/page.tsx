import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Plug,
  BookOpen,
  GitPullRequestArrow,
  ShieldCheck,
  ScrollText,
  Users,
  Briefcase,
  Building2,
} from "lucide-react";
import { HeroSection } from "@/components/marketing/hero";
import { UpgradeButton } from "@/components/marketing/upgrade_button";
import * as PricingCard from "@/components/ui/pricing-card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Poggle — The governed context layer for AI agents",
  description:
    "Agents connect over MCP, read your workspace context, and propose changes you approve. Poggle is the trust gate between your AI agents and your source of truth.",
};

// ─── The loop ────────────────────────────────────────────────────────────────

const LOOP = [
  {
    icon: Plug,
    step: "01",
    title: "Connect over MCP",
    body: "Pog and any MCP-capable agent connect to your workspace with a scoped token. One protocol, no bespoke integrations.",
  },
  {
    icon: BookOpen,
    step: "02",
    title: "Read your context",
    body: "Agents read the notes, files, and decisions that matter — the same source of truth your team works from, always current.",
  },
  {
    icon: GitPullRequestArrow,
    step: "03",
    title: "Propose changes",
    body: "Agents never write directly. Every change arrives as a proposal — a reviewable diff against your workspace.",
  },
  {
    icon: ShieldCheck,
    step: "04",
    title: "You approve",
    body: "A human reviews and approves before anything lands. The trust gate stays closed until you open it.",
  },
];

// ─── Why it matters ──────────────────────────────────────────────────────────

const PILLARS = [
  {
    icon: GitPullRequestArrow,
    title: "Proposals, not writes",
    body: "Agents submit reviewable diffs. You see exactly what would change, in context, before it happens — no silent edits to your source of truth.",
  },
  {
    icon: ShieldCheck,
    title: "A real trust gate",
    body: "Approval is required, not optional. Scope what each agent can read and propose, and keep a human in the loop on every change.",
  },
  {
    icon: ScrollText,
    title: "Every action audited",
    body: "Connect, read, propose, approve — it's all on an append-only log with full version history and one-click rollback.",
  },
];

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" aria-hidden="true" />
      <p className="text-[15px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

// ─── Pricing snapshot ────────────────────────────────────────────────────────

type Plan = {
  icon: React.ReactNode;
  name: string;
  price: string;
  period: string | null;
  annual: string | null;
  badge: string | null;
  description: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    icon: <Users />,
    name: "Free",
    price: "Free",
    period: null,
    annual: null,
    badge: null,
    description: "Connect your first agent and try the trust gate.",
    features: ["1 agent connection", "3 boxes", "Proposal review", "7-day history"],
  },
  {
    icon: <Briefcase />,
    name: "Pro",
    price: "$12",
    period: "/month",
    annual: "$9",
    badge: "Popular",
    description: "For teams running agents on real context.",
    features: [
      "Unlimited agents & boxes",
      "Scoped MCP access",
      "Full version history",
      "Append-only audit log",
    ],
  },
  {
    icon: <Building2 />,
    name: "Team",
    price: "$39",
    period: "/month",
    annual: "$29",
    badge: null,
    description: "Shared, governed context for the whole org.",
    features: ["Everything in Pro", "Shared workspaces", "SSO / SAML", "Priority support"],
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  await connection();
  return (
    <div className="min-h-screen bg-background">
      <HeroSection />

      {/* ── The loop ──────────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-overline text-violet-400">The loop</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              One governed loop, end to end.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Connect, read, propose, approve. Every agent follows the same path,
              and a human holds the gate at the end of it.
            </p>
          </div>

          <ol className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {LOOP.map((item) => (
              <li
                key={item.step}
                className="relative rounded-xl border border-border/50 bg-card p-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                    <item.icon className="h-5 w-5 text-violet-400" aria-hidden="true" />
                  </div>
                  <span className="text-overline text-muted-foreground/50">
                    {item.step}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── The trust gate ────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 bg-muted/20 px-6 py-24">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="text-overline text-violet-400">The trust gate</p>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Give agents context.
                <br />
                Keep control of the truth.
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                Letting an AI agent write straight to your knowledge base is how
                small mistakes become permanent ones. Poggle puts a human between
                the agent and your source of truth — without slowing the agent down.
              </p>
            </div>
            <div className="space-y-4">
              <Bullet>
                <span className="font-medium text-foreground">Read freely, write never.</span>{" "}
                Agents have rich read access but cannot mutate anything directly.
              </Bullet>
              <Bullet>
                <span className="font-medium text-foreground">Approve in context.</span>{" "}
                Review each proposal as a diff, then approve, edit, or reject.
              </Bullet>
              <Bullet>
                <span className="font-medium text-foreground">Reverse anything.</span>{" "}
                Full version history and one-click rollback on every object.
              </Bullet>
            </div>
            <Button variant="outline" render={<Link href="/how-it-works" />}>
              See the full flow
            </Button>
          </div>

          {/* Proposal illustration — semantic tokens, no chrome gimmicks */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-border/50 pb-4">
              <div className="flex items-center gap-2">
                <GitPullRequestArrow className="h-4 w-4 text-violet-400" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">
                  Proposal from Pog
                </span>
              </div>
              <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-400">
                Pending review
              </span>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Update <span className="font-medium text-foreground">architecture.md</span>{" "}
              in <span className="font-medium text-foreground">Decisions</span>
            </p>
            <div className="mt-4 space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-4 text-sm">
              <p className="rounded bg-destructive/10 px-2 py-1 text-muted-foreground">
                <span className="mr-2 text-destructive">−</span>
                Caching strategy: undecided
              </p>
              <p className="rounded bg-violet-500/10 px-2 py-1 text-foreground">
                <span className="mr-2 text-violet-400">+</span>
                Caching strategy: read-through, 5-minute TTL
              </p>
            </div>
            <div className="mt-5 flex items-center gap-2">
              <Button size="sm" className="flex-1">
                Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1">
                Request changes
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pillars ───────────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-overline text-violet-400">Why Poggle</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Governance built in, not bolted on.
            </h2>
          </div>
          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {PILLARS.map((pillar) => (
              <div
                key={pillar.title}
                className="rounded-xl border border-border/50 bg-card p-6"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                  <pillar.icon className="h-5 w-5 text-violet-400" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">
                  {pillar.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {pillar.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing snapshot ──────────────────────────────────────────────── */}
      <section className="border-b border-border/30 bg-muted/20 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 max-w-xl">
            <p className="text-overline text-violet-400">Pricing</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Start free, govern at scale.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Connect your first agent for free. Upgrade when you need unlimited
              agents and a full audit trail.
            </p>
          </div>
          <div className="grid grid-cols-1 justify-items-center gap-6 md:grid-cols-3">
            {PLANS.map((plan) => (
              <PricingCard.Card key={plan.name} className="w-full md:min-w-[260px]">
                <PricingCard.Header>
                  <PricingCard.Plan>
                    <PricingCard.PlanName>
                      {plan.icon}
                      {plan.name}
                    </PricingCard.PlanName>
                    {plan.badge && <PricingCard.Badge>{plan.badge}</PricingCard.Badge>}
                  </PricingCard.Plan>
                  <PricingCard.Price>
                    <PricingCard.MainPrice>{plan.price}</PricingCard.MainPrice>
                    {plan.period && <PricingCard.Period>{plan.period}</PricingCard.Period>}
                  </PricingCard.Price>
                  {plan.annual && (
                    <p className="mb-3 -mt-1 text-xs text-muted-foreground">
                      or {plan.annual}/mo billed annually
                    </p>
                  )}
                  {plan.name === "Pro" ? (
                    <UpgradeButton>Start free trial</UpgradeButton>
                  ) : plan.name === "Team" ? (
                    <Button
                      variant="outline"
                      className="w-full font-semibold"
                      render={<a href="mailto:hello@poggle.app?subject=Poggle%20Team%20plan" />}
                    >
                      Contact sales
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full font-semibold"
                      render={<Link href="/sign_in" />}
                    >
                      Get started free
                    </Button>
                  )}
                </PricingCard.Header>
                <PricingCard.Body>
                  <PricingCard.Description>{plan.description}</PricingCard.Description>
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
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground/60">
              All paid plans include a 14-day free trial. No credit card required.
            </p>
            <Link
              href="/pricing"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Full pricing details →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="px-6 py-36 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Put a human in the loop.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground">
            Give your agents the context they need — and the trust gate they
            can&apos;t cross. Free to start.
          </p>
          <div className="mt-10 flex justify-center">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get started free
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
