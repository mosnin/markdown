import { connection } from "next/server";
import Link from "next/link";
import { Check, CheckCircle2, Users, Briefcase, Building2 } from "lucide-react";
import { HeroSection } from "@/components/marketing/hero";
import * as PricingCard from "@/components/ui/pricing-card";
import { Button } from "@/components/ui/button";
import { NotificationCenterFeed } from "@/components/ui/live-feed";
import { AnomalyHeatmap } from "@/components/ui/anomaly-heatmap";

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
            architecture.md — Atlas
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
          <span className="ml-2 text-muted-foreground/60">atlas</span>
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

export default async function HomePage() {
  await connection();
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
                  Boxes are focused containers for your projects and topics. Inside each box,
                  use folders, notes, files, skills, and agents — all navigable in an
                  interactive tree with drag-and-drop.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Five object types">
                  Notes for documents, files for code, skills for reusable modules, agents for orchestrators, and folders for structure.
                </Bullet>
                <Bullet title="Semantic links">
                  Connect any object to any other with ten typed relationship types — not just backlinks.
                </Bullet>
                <Bullet title="Tree and graph views">
                  Navigate your workspace in the sidebar tree or explore the full knowledge graph visually.
                </Bullet>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <NotificationCenterFeed />
            </div>
          </div>
        </div>
      </section>

      {/* ── Bundle ────────────────────────────────────────────────────────────── */}
      <section className="border-b border-border/30 bg-muted/20 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="order-2 flex justify-center lg:order-1 lg:justify-start">
              <AnomalyHeatmap
                cardTitle="Token density"
                cardDescription="Token distribution across bundled notes — trim to any model's context window."
              />
            </div>
            <div className="order-1 space-y-8 lg:order-2">
              <div className="space-y-4">
                <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                  Build real structure.
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  Skills and agents are more than single files. Each one has a canonical source
                  plus supporting files and nested folders — real package structure, not flat blobs.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Skills">
                  Lighter reusable modules you can share across boxes. One source file, many supporting files.
                </Bullet>
                <Bullet title="Agents">
                  Heavier orchestrators with type, model hint, system prompt, and skill references.
                </Bullet>
                <Bullet title="Portable exports">
                  Export any box, folder, skill, or agent as a structured zip with manifest and history.
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
                  Every edit to every object is tracked. Notes, files, skills, and agents
                  all have full version history with one-click rollback and an append-only audit log.
                </p>
              </div>
              <div className="space-y-4">
                <Bullet title="Version history">
                  Every save creates a version across all object types — not just notes.
                </Bullet>
                <Bullet title="One-click rollback">
                  Restore any prior version of any object instantly.
                </Bullet>
                <Bullet title="Full audit log">
                  Every action is recorded — creates, edits, lifecycle changes, and machine writes.
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
              Start free, upgrade when you&apos;re ready. No lock-in, no surprises.
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
                features: ["100 notes & files", "3 boxes", "Skills & agents", "7-day version history"],
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
                features: ["Unlimited everything", "Unlimited boxes", "Full graph & tree views", "Full version history", "API & MCP access"],
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
            It&apos;s your time to focus.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground">
            Free to start. Bring your notes, files, skills, and agents together in one place.
          </p>
          <div className="mt-10 flex justify-center">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get Atlas
            </Button>
          </div>
        </div>
      </section>

    </div>
  );
}
