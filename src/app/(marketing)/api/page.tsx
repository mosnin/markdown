import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookText,
  Code2,
  Gauge,
  KeyRound,
  Plug,
  Terminal,
  Webhook,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { FeatureTabs, type FeatureTab } from "@/components/marketing/feature_tabs";
import { ConnectionTopology } from "@/components/marketing/connection_topology";
import { TiltCard } from "@/components/marketing/tilt_card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "API — Poggle",
  description:
    "Build on the governed context layer: a REST API, native MCP tools, scoped OAuth tokens, and webhooks — all under the same trust gate and audit log.",
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-300">
      {children}
    </div>
  );
}

const TABS: FeatureTab[] = [
  {
    id: "rest",
    label: "REST",
    title: "A clean REST API",
    body: "Read notes, list boxes, and submit proposals over plain HTTP with a scoped bearer token. Predictable resources, JSON in and out.",
    icon: <Code2 className="size-4" aria-hidden="true" />,
    visual: (
      <Code>
        <p><span className="text-violet-400">GET</span> /api/v1/notes/:id</p>
        <p className="text-zinc-500">Authorization: Bearer cso_a_…</p>
        <p className="mt-2 text-emerald-400">200 OK</p>
        <p>{`{ "title": "Rate limits",`}</p>
        <p>{`  "box": "Engineering" }`}</p>
      </Code>
    ),
  },
  {
    id: "mcp",
    label: "MCP",
    title: "Native MCP tools",
    body: "The same capabilities your agents use are first-class MCP tools — search, read context bundles, and create proposals, all scope-checked.",
    icon: <Terminal className="size-4" aria-hidden="true" />,
    visual: (
      <Code>
        <p className="text-zinc-500">tools/call</p>
        <p><span className="text-violet-400">create_write_proposal</span></p>
        <p>{`{ "target": "architecture.md",`}</p>
        <p>{`  "diff": "…" }`}</p>
        <p className="mt-2 text-emerald-400">→ proposal queued for review</p>
      </Code>
    ),
  },
  {
    id: "webhooks",
    label: "Webhooks",
    title: "Webhooks on every event",
    body: "Subscribe to proposal, approval, and connection events to drive your own automations — every payload signed and replay-protected.",
    icon: <Webhook className="size-4" aria-hidden="true" />,
    visual: (
      <Code>
        <p className="text-zinc-500">POST https://your-app/hook</p>
        <p><span className="text-violet-400">event</span>: proposal.approved</p>
        <p>{`{ "proposal_id": "…",`}</p>
        <p>{`  "approved_by": "you@team" }`}</p>
      </Code>
    ),
  },
];

const FEATURES = [
  { icon: Code2, title: "REST API", body: "Resource-oriented endpoints for notes, boxes, proposals, and connections." },
  { icon: Plug, title: "MCP-native", body: "Every capability is exposed as a Model Context Protocol tool, not an afterthought." },
  { icon: KeyRound, title: "Scoped OAuth tokens", body: "OAuth 2.1 + PKCE with per-box, per-capability scopes on every request." },
  { icon: Webhook, title: "Signed webhooks", body: "HMAC-signed, replay-protected event delivery for your own automations." },
  { icon: Gauge, title: "Rate limits & quotas", body: "Predictable limits with clear headers — and a paywall that fails closed, never open." },
  { icon: BookText, title: "Documented & versioned", body: "Stable, versioned surfaces so integrations don't break under you." },
];

export default function ApiPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="API"
        title="Build on the governed context layer."
        description="REST, native MCP tools, scoped OAuth, and webhooks — everything your integration needs, under the same trust gate and audit log as the rest of Poggle."
        ctaPrimary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "Connect an agent", href: "/connections" }}
      />

      {/* Interactive code samples */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="Three ways in"
          title="However you build, it's governed the same."
          lede="REST for your services, MCP for your agents, webhooks for your automations — all scope-checked and audited."
        />
        <FeatureTabs tabs={TABS} />
      </MarketingSection>

      {/* Topology */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="Topology"
          title="Many agents. One scoped door."
          lede="Every client connects through a single OAuth-scoped MCP endpoint that grants read and propose on only the boxes you choose — never write, never delete."
        />
        <div className="mt-12">
          <ConnectionTopology />
        </div>
      </MarketingSection>

      {/* Capabilities */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader eyebrow="What's in the box" title="A surface you can trust to stay put." />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <TiltCard key={f.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </TiltCard>
            );
          })}
        </div>
      </MarketingSection>

      {/* CTA */}
      <MarketingSection>
        <BentoCard tone="gradient" className="px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-hero text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Start building in minutes.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/80 sm:text-lg">
              Create a workspace, mint a scoped token, and make your first call — free.
            </p>
            <div className="mt-9 flex justify-center">
              <Button
                size="lg"
                className="rounded-full bg-white text-violet-700 hover:bg-white/90"
                render={<Link href="/sign_in?mode=signup" />}
              >
                Get started free
                <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </BentoCard>
      </MarketingSection>
    </div>
  );
}
