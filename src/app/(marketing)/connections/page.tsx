import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  KeyRound,
  Lock,
  Plug,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  GitPullRequestArrow,
  Check,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { FeatureTabs, type FeatureTab } from "@/components/marketing/feature_tabs";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Connections — Poggle",
  description:
    "Connect any MCP-capable agent to your workspace with OAuth 2.1 + PKCE and per-box scopes. Agents read and propose; they never write directly.",
};

const FEATURES = [
  {
    icon: KeyRound,
    title: "OAuth 2.1 + PKCE",
    body: "Standards-based authorization with proof-key-for-code-exchange. No long-lived secrets passed around, no bespoke auth to build.",
  },
  {
    icon: SlidersHorizontal,
    title: "Per-box, per-capability scopes",
    body: "Grant an agent read on three boxes and propose on one. The token carries exactly that — nothing more.",
  },
  {
    icon: RefreshCw,
    title: "Rotation & revocation",
    body: "Rotate tokens on a schedule and revoke any agent instantly. A revoked token's whole refresh family dies with it.",
  },
  {
    icon: ScrollText,
    title: "Every call audited",
    body: "Connect, read, propose — each action is attributed to a client on an append-only log you can export.",
  },
  {
    icon: Plug,
    title: "Works with any MCP client",
    body: "Claude, Cursor, and anything else that speaks the Model Context Protocol. One protocol, zero custom integrations.",
  },
  {
    icon: Lock,
    title: "Read, never write",
    body: "Connected agents physically cannot mutate your source of truth. The only path in is a proposal you approve.",
  },
];

const TABS: FeatureTab[] = [
  {
    id: "register",
    label: "Register",
    title: "Register your client",
    body: "Create an OAuth client in seconds. You get a client ID and configure your redirect URI — confidential or public, your call.",
    icon: <KeyRound className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs rounded-2xl border border-border/60 bg-card/70 p-4 font-mono text-[11px] leading-relaxed">
        <p className="text-muted-foreground/70">client_id</p>
        <p className="truncate text-foreground">cli_9f2a…e10b</p>
        <p className="mt-2 text-muted-foreground/70">redirect_uri</p>
        <p className="truncate text-foreground">https://app/callback</p>
        <p className="mt-2 text-muted-foreground/70">grant</p>
        <p className="text-violet-500">authorization_code + PKCE</p>
      </div>
    ),
  },
  {
    id: "scope",
    label: "Scope",
    title: "Scope the grant",
    body: "On the consent screen you pick exactly which boxes the agent can reach and whether it may propose. You can only narrow what it asked for, never broaden it.",
    icon: <SlidersHorizontal className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs space-y-1.5">
        {[
          { label: "Read · Engineering", on: true },
          { label: "Read · Support", on: true },
          { label: "Propose · Engineering", on: true },
          { label: "Write directly", on: false },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/70 px-3 py-2"
          >
            <span
              className={`flex size-4 items-center justify-center rounded-md ${
                s.on ? "bg-violet-600 text-white" : "border border-border/70 text-transparent"
              }`}
            >
              <Check className="size-3" aria-hidden="true" />
            </span>
            <span className={`text-[12px] ${s.on ? "text-foreground" : "text-muted-foreground/50"}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "connect",
    label: "Connect",
    title: "Connect over MCP",
    body: "Your agent exchanges the code for a scoped token and connects. From here it can read the boxes you allowed — and only those.",
    icon: <Terminal className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs rounded-2xl border border-border/60 bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-300">
        <p><span className="text-emerald-400">$</span> claude mcp add poggle</p>
        <p className="text-zinc-500">→ opening consent…</p>
        <p className="text-emerald-400">✓ connected · scope: read, propose</p>
        <p className="text-zinc-500">→ 12 notes available</p>
      </div>
    ),
  },
  {
    id: "propose",
    label: "Propose",
    title: "It proposes, you approve",
    body: "When the agent wants to change something, it submits a proposal. You review the diff and approve — the only way anything is ever written.",
    icon: <GitPullRequestArrow className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs rounded-2xl border border-border/60 bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
        <p className="mb-1 text-muted-foreground/70">proposal · pending</p>
        <p className="rounded bg-emerald-500/10 px-1.5 text-emerald-500">+ Add rate-limit section</p>
        <p className="rounded bg-emerald-500/10 px-1.5 text-emerald-500">+ 1,000 req/min per token</p>
        <div className="mt-2 flex gap-1.5">
          <span className="rounded-md bg-violet-600 px-2 py-1 text-[10px] font-semibold text-white">Approve</span>
          <span className="rounded-md border border-border/70 px-2 py-1 text-[10px] text-muted-foreground">Reject</span>
        </div>
      </div>
    ),
  },
];

const CLIENTS = ["Claude", "Cursor", "Cline", "Continue", "Zed", "Your own agent"];

export default function ConnectionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Connections · MCP"
        title="Connect any agent. Govern every one."
        description="Bring the agents you already use. They connect over the Model Context Protocol with a scoped token, read the context you allow, and propose changes you approve."
        ctaPrimary={{ label: "Connect an agent", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "Read the flow", href: "/how-it-works" }}
      />

      {/* Connect flow */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="The connect flow"
          title="From zero to governed in four steps."
          lede="Register a client, scope the grant, connect, and review. No bespoke integration work, ever."
        />
        <FeatureTabs tabs={TABS} />
      </MarketingSection>

      {/* Capabilities */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader
          eyebrow="Built for trust"
          title="Authorization that does the governing for you."
        />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <BentoCard key={f.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </BentoCard>
            );
          })}
        </div>
      </MarketingSection>

      {/* Works with */}
      <MarketingSection className="border-b border-border/30">
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-violet-500">
            Works with
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {CLIENTS.map((c) => (
              <span
                key={c}
                className="rounded-full border border-border/60 bg-card/50 px-4 py-2 text-sm font-medium text-foreground/80"
              >
                {c}
              </span>
            ))}
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            If it speaks MCP, it works with Poggle — no plugin to install, no adapter to maintain.
          </p>
        </div>
      </MarketingSection>

      {/* CTA */}
      <MarketingSection>
        <BentoCard tone="gradient" className="px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <span className="flex justify-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
                <ShieldCheck className="size-6" aria-hidden="true" />
              </span>
            </span>
            <h2 className="mt-5 font-hero text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Bring your agents. Keep the keys.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/80 sm:text-lg">
              Connect your first agent free and scope it in under a minute.
            </p>
            <div className="mt-9 flex justify-center">
              <Button
                size="lg"
                className="rounded-full bg-white text-violet-700 hover:bg-white/90"
                render={<Link href="/sign_in?mode=signup" />}
              >
                Connect an agent
                <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </BentoCard>
      </MarketingSection>
    </div>
  );
}
