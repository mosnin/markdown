import Link from "next/link";
import { Check, CheckCircle2, Users, Briefcase, Building2 } from "lucide-react";
import { HeroSection } from "@/components/marketing/hero";
import * as PricingCard from "@/components/ui/pricing-card";
import { Button } from "@/components/ui/button";

// ─── App visuals ──────────────────────────────────────────────────────────────

function AppMockup() {
  return (
    <div className="relative w-full max-w-md">
      <div className="absolute -inset-6 rounded-3xl bg-violet-600/6 blur-3xl" />
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl shadow-black/30">
        <div className="flex items-center gap-2 border-b border-border/40 bg-muted/40 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          <span className="ml-3 font-mono text-[11px] text-muted-foreground/60">
            architecture.md — Context Store
          </span>
        </div>
        <div className="grid grid-cols-5 divide-x divide-border/40">
          <div className="col-span-2 p-3 font-mono text-[11px]">
            <p className="mb-2.5 text-[10px] uppercase tracking-widest text-muted-foreground/40">
              Boxes
            </p>
            {[
              { name: "Architecture", active: true },
              { name: "Decisions", active: false },
              { name: "References", active: false },
              { name: "Journal", active: false },
            ].map((box) => (
              <div
                key={box.name}
                className={`mb-0.5 flex items-center gap-1.5 rounded px-1.5 py-1 ${
                  box.active
                    ? "bg-violet-500/15 text-violet-400"
                    : "text-muted-foreground/60"
                }`}
              >
                <span className="text-[9px]">⬡</span>
                {box.name}
              </div>
            ))}
          </div>
          <div className="col-span-3 p-3 font-mono text-[11px] text-muted-foreground/70">
            <p className="mb-1.5 font-semibold text-foreground"># System Design</p>
            <p className="text-violet-400/70">## Overview</p>
            <p className="mt-1">The API layer sits between the</p>
            <p>client and the database.</p>
            <p className="mt-2 text-violet-400/70">## Components</p>
            <p className="mt-1">
              - <span className="text-foreground/80">Auth middleware</span>
            </p>
            <p>
              - <span className="text-foreground/80">Context engine</span>
            </p>
            <p>
              - <span className="text-foreground/80">Version store</span>
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-4 py-2">
          <span className="font-mono text-[10px] text-muted-foreground/50">v12 · 2 min ago</span>
          <span className="rounded bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-400">
            ⚡ Bundle ready
          </span>
        </div>
      </div>
    </div>
  );
}

function BoxesMockup() {
  return (
    <div className="relative w-full max-w-md">
      <div className="absolute -inset-4 rounded-3xl bg-violet-600/5 blur-2xl" />
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card font-mono text-xs shadow-xl shadow-black/20">
        <div className="flex items-center gap-2 border-b border-border/40 bg-muted/40 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          <span className="ml-2 text-muted-foreground/60">context-store</span>
        </div>
        <div className="space-y-1 p-4 leading-relaxed text-muted-foreground/70">
          <p>
            <span className="text-violet-400">⬡</span>{" "}
            <span className="text-foreground/80">Architecture</span>
          </p>
          <p className="pl-4">
            ├── <span className="text-foreground/70">system_design.md</span>
          </p>
          <p className="pl-4">
            ├── <span className="text-foreground/70">api_contracts.md</span>
          </p>
          <p className="pl-4">
            └── <span className="text-foreground/70">data_flow.md</span>
          </p>
          <p className="mt-2">
            <span className="text-violet-400">⬡</span>{" "}
            <span className="text-foreground/80">Decisions</span>
          </p>
          <p className="pl-4">
            ├── <span className="text-foreground/70">caching_strategy.md</span>
          </p>
          <p className="pl-4">
            └── <span className="text-foreground/70">auth_approach.md</span>
          </p>
          <p className="mt-2">
            <span className="text-violet-400">⬡</span>{" "}
            <span className="text-foreground/80">References</span>
          </p>
          <p className="pl-4">
            └── <span className="text-foreground/70">external_apis.md</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function BundleMockup() {
  return (
    <div className="relative w-full max-w-md">
      <div className="absolute -inset-4 rounded-3xl bg-violet-600/5 blur-2xl" />
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card font-mono text-xs shadow-xl shadow-black/20">
        <div className="flex items-center gap-2 border-b border-border/40 bg-muted/40 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          <span className="ml-2 text-muted-foreground/60">context_bundle.md</span>
        </div>
        <div className="space-y-1.5 p-4">
          <p>
            <span className="text-violet-400">📦</span>{" "}
            <span className="font-medium text-foreground/80">AI Refactoring Bundle</span>
          </p>
          <p className="text-muted-foreground/40">──────────────────────────</p>
          <p>
            <span className="text-green-400">✓</span>{" "}
            <span className="text-foreground/70">system_design.md</span>{" "}
            <span className="text-muted-foreground/50">840 tok</span>
          </p>
          <p>
            <span className="text-green-400">✓</span>{" "}
            <span className="text-foreground/70">api_contracts.md</span>{" "}
            <span className="text-muted-foreground/50">612 tok</span>
          </p>
          <p>
            <span className="text-green-400">✓</span>{" "}
            <span className="text-foreground/70">auth_approach.md</span>{" "}
            <span className="text-muted-foreground/50">440 tok</span>
          </p>
          <p className="text-muted-foreground/40">──────────────────────────</p>
          <p>
            <span className="text-violet-400">⚡</span>{" "}
            <span className="text-foreground/70">3 notes</span>{" "}
            <span className="text-muted-foreground/50">· 1,892 / 4,096 tokens</span>
          </p>
          <p className="pt-1 text-muted-foreground/40">
            Ready to paste into Claude, GPT-4, or any model.
          </p>
        </div>
      </div>
    </div>
  );
}

function HistoryMockup() {
  return (
    <div className="relative w-full max-w-md">
      <div className="absolute -inset-4 rounded-3xl bg-violet-600/5 blur-2xl" />
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card font-mono text-xs shadow-xl shadow-black/20">
        <div className="flex items-center gap-2 border-b border-border/40 bg-muted/40 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          <span className="ml-2 text-muted-foreground/60">version history</span>
        </div>
        <div className="space-y-3 p-4">
          {[
            { v: "v4", time: "2 min ago", label: "current", active: true },
            { v: "v3", time: "1 hr ago", label: "added caching notes", active: false },
            { v: "v2", time: "yesterday", label: "initial draft", active: false },
            { v: "v1", time: "3 days ago", label: "created", active: false },
          ].map((row) => (
            <div key={row.v} className="flex items-center gap-3">
              <span className="w-5 text-violet-400">{row.v}</span>
              <span
                className={
                  row.active ? "text-foreground/80" : "text-muted-foreground/60"
                }
              >
                {row.label}
              </span>
              <span className="ml-auto text-muted-foreground/40">{row.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function Bullet({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex gap-3">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{title}.</span> {children}
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <HeroSection />

      {/* ── Organize ──────────────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                  Organize deliberately.
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  Boxes aren't just folders. They're semantic containers with a built-in
                  guide that defines their purpose — so your notes always fit their context.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Box guides">
                  Define the purpose and shape of each container so every note knows where it belongs.
                </Bullet>
                <Bullet title="Bidirectional links">
                  Surface related knowledge automatically across boxes and topics.
                </Bullet>
                <Bullet title="Nested hierarchy">
                  Mirror the real structure of your thinking with folders and sub-boxes.
                </Bullet>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <BoxesMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── Bundle ────────────────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 bg-muted/20 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="order-2 flex justify-center lg:order-1 lg:justify-start">
              <BundleMockup />
            </div>
            <div className="order-1 space-y-8 lg:order-2">
              <div className="space-y-4">
                <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                  Bundle precisely.
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  Stop copy-pasting into chat windows. Assemble the right notes, trim to your
                  token budget, and export a clean bundle for any AI model in one click.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Token-aware export">
                  Set a budget and Context Store selects the most relevant notes that fit within it.
                </Bullet>
                <Bullet title="Freshness scoring">
                  Recently updated notes surface first so your AI always gets current context.
                </Bullet>
                <Bullet title="Universal format">
                  Export as markdown, JSON, or plain text — compatible with any model or workflow.
                </Bullet>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── History ───────────────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                  Own your history.
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  Every edit is tracked. Every version is restorable. Context Store maintains
                  a complete audit trail so nothing is ever truly gone.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Version history">
                  Track changes between every revision with one year of history per note.
                </Bullet>
                <Bullet title="One-click rollback">
                  Restore any prior version instantly — no manual diff required.
                </Bullet>
                <Bullet title="Full audit log">
                  Team accountability and compliance visibility, built in from the start.
                </Bullet>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <HistoryMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 bg-muted/20 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 max-w-xl">
            <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Simple pricing.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Start free, upgrade when you're ready. No lock-in, no surprises.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 justify-items-center md:grid-cols-3">
            {[
              {
                icon: <Users />,
                name: "Free",
                price: "Free",
                period: null as string | null,
                annual: null as string | null,
                badge: null as string | null,
                description: "Start organizing your knowledge.",
                cta: "Get started free",
                href: "/sign_in",
                variant: "outline" as const,
                features: ["100 notes", "3 boxes", "Basic context export", "7-day version history"],
              },
              {
                icon: <Briefcase />,
                name: "Pro",
                price: "$12",
                period: "/month",
                annual: "$9",
                badge: "Popular",
                description: "For serious knowledge workers.",
                cta: "Start free trial",
                href: "/sign_in",
                variant: "default" as const,
                features: ["Unlimited notes", "Unlimited boxes", "AI context bundles", "Full version history", "API access"],
              },
              {
                icon: <Building2 />,
                name: "Team",
                price: "$39",
                period: "/month",
                annual: "$29",
                badge: null as string | null,
                description: "Shared context for collaborative teams.",
                cta: "Contact sales",
                href: "/contact",
                variant: "outline" as const,
                features: ["Everything in Pro", "Shared workspaces", "Team audit log", "SSO / SAML", "Priority support"],
              },
            ].map((plan) => (
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
                  <PricingCard.Description>{plan.description}</PricingCard.Description>
                  <PricingCard.List>
                    {plan.features.map((feature) => (
                      <PricingCard.ListItem key={feature}>
                        <CheckCircle2 className="size-4 shrink-0 text-violet-400" aria-hidden="true" />
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
              All plans include a 14-day free trial. No credit card required.
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

      {/* ── Final CTA ─────────────────────────────────────────────────────────── */}
      <section className="px-6 py-36 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            It's your time to focus.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground">
            Free to start. Import your existing notes in minutes.
          </p>
          <div className="mt-10">
            <Link
              href="/sign_in"
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-8 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
            >
              Get Context Store
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
