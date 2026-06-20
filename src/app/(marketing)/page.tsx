import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Eye,
  GitPullRequestArrow,
  Lock,
  ScrollText,
  ShieldCheck,
  Users,
  Briefcase,
  Building2,
  ArrowRight,
} from "lucide-react";
import { HeroSection } from "@/components/marketing/hero";
import { McpCompat } from "@/components/marketing/mcp_compat";
import { MatrixCta } from "@/components/marketing/matrix_cta";
import { LoopStepper } from "@/components/marketing/loop_stepper";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { UpgradeButton } from "@/components/marketing/upgrade_button";
import * as PricingCard from "@/components/ui/pricing-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Poggle — The governed context layer for AI agents",
  description:
    "Agents connect over MCP, read your workspace context, and propose changes you approve. Poggle is the trust gate between your AI agents and your source of truth.",
};

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
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
        <Check className="size-3 text-violet-500" aria-hidden="true" />
      </span>
      <p className="text-[15px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

// ─── Scoped-access governance card (static visual for the trust-gate) ─────────

const ACCESS_ROWS = [
  { icon: Eye, label: "Read", value: "Engineering · Support · GTM", allowed: true },
  { icon: GitPullRequestArrow, label: "Propose", value: "Engineering", allowed: true },
  { icon: Lock, label: "Write directly", value: "Never", allowed: false },
  { icon: Lock, label: "Delete", value: "Never", allowed: false },
];

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

      {/* ── Compatibility (works with any MCP client) ──────────────────────── */}
      <McpCompat />

      {/* ── The loop (interactive) ─────────────────────────────────────────── */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="The loop"
          title="One governed loop, end to end."
          lede="Connect, read, propose, approve. Every agent follows the same path, and a human holds the gate at the end of it."
        />
        <LoopStepper />
      </MarketingSection>

      {/* ── The trust gate ─────────────────────────────────────────────────── */}
      <MarketingSection muted className="border-b border-border/30">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="space-y-8">
            <SectionHeader
              eyebrow="The trust gate"
              title={
                <>
                  Give agents context.
                  <br />
                  Keep control of the truth.
                </>
              }
              lede="Letting an AI agent write straight to your knowledge base is how small mistakes become permanent ones. Poggle puts a human between the agent and your source of truth — without slowing the agent down."
            />
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
            <Button variant="outline" className="rounded-full" render={<Link href="/how-it-works" />}>
              See the full flow
              <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
            </Button>
          </div>

          {/* Scoped-access card */}
          <BentoCard className="p-0">
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-violet-500/15 text-[11px] font-semibold text-violet-500">
                  C
                </span>
                <span className="text-sm font-medium text-foreground">Claude · access</span>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-500">
                Scoped
              </span>
            </div>
            <ul className="flex list-none flex-col divide-y divide-border/40 px-6">
              {ACCESS_ROWS.map((row) => {
                const Icon = row.icon;
                return (
                  <li key={row.label} className="flex items-center gap-3 py-3.5">
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        row.allowed ? "text-violet-500" : "text-muted-foreground/50",
                      )}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium text-foreground">{row.label}</span>
                    <span
                      className={cn(
                        "ml-auto text-right text-[13px]",
                        row.allowed ? "text-muted-foreground" : "text-muted-foreground/50",
                      )}
                    >
                      {row.value}
                    </span>
                    {row.allowed ? (
                      <Check className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
                    ) : (
                      <Lock className="size-4 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-2 border-t border-border/50 px-6 py-4 text-[12px] text-muted-foreground">
              <ScrollText className="size-3.5 text-violet-500" aria-hidden="true" />
              Every action lands on an append-only audit log.
            </div>
          </BentoCard>
        </div>
      </MarketingSection>

      {/* ── Pillars (bento) ────────────────────────────────────────────────── */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader eyebrow="Why Poggle" title="Governance built in, not bolted on." />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <BentoCard key={pillar.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">
                  {pillar.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {pillar.body}
                </p>
              </BentoCard>
            );
          })}
        </div>
      </MarketingSection>

      {/* ── Pricing snapshot ───────────────────────────────────────────────── */}
      <MarketingSection muted className="border-b border-border/30">
        <div className="mb-12">
          <SectionHeader
            eyebrow="Pricing"
            title="Start free, govern at scale."
            lede="Connect your first agent for free. Upgrade when you need unlimited agents and a full audit trail."
          />
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
      </MarketingSection>

      {/* ── Final CTA (matrix-rain background) ─────────────────────────────── */}
      <MatrixCta
        title="Put a human in the loop."
        subtitle="Give your agents the context they need — and the trust gate they can't cross. Free to start."
        primary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
        secondary={{ label: "See how it works", href: "/how-it-works" }}
      />
    </div>
  );
}
