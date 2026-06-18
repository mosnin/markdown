import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Download,
  FileText,
  GitBranch,
  GitPullRequestArrow,
  History,
  Network,
  Plug,
  Puzzle,
  ScrollText,
  Search,
  ShieldCheck,
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
  title: "Features — Poggle",
  description:
    "A governed context layer for AI agents: structured markdown knowledge, scoped MCP access, reviewable proposals, full version history, and an append-only audit log.",
};

const CAPABILITIES = [
  {
    icon: FileText,
    title: "Markdown-native notes",
    body: "Everything is plain markdown with structured metadata — readable by humans and agents alike, never locked in a proprietary format.",
  },
  {
    icon: GitBranch,
    title: "Boxes & branches",
    body: "Group knowledge into boxes, and let agents draft on isolated branches that only reach the main thread once you promote them.",
  },
  {
    icon: Network,
    title: "Knowledge graph",
    body: "Notes, entities, and links form a live graph, so agents retrieve the right context instead of guessing from a flat search.",
  },
  {
    icon: Puzzle,
    title: "Skills & sub-agents",
    body: "Package reusable capabilities your agents can call, each running in a fresh context window so the orchestrator stays lean.",
  },
  {
    icon: Plug,
    title: "Scoped MCP access",
    body: "Connect any MCP agent with a token scoped to specific boxes and capabilities. Grant read, grant propose — never grant a free hand.",
  },
  {
    icon: History,
    title: "Audit log & rollback",
    body: "Connect, read, propose, approve — all on an append-only log with full version history and one-click rollback on every object.",
  },
];

// ── Interactive explorer tabs (static visuals; interaction lives in FeatureTabs)

const TABS: FeatureTab[] = [
  {
    id: "capture",
    label: "Capture",
    title: "Structured, markdown-native knowledge",
    body: "Notes live in boxes with tags, summaries, and links — a source of truth your team edits and your agents can read with precision.",
    icon: <FileText className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs rounded-2xl border border-border/60 bg-card/70 p-4">
        <div className="flex items-center gap-2 border-b border-border/50 pb-2.5">
          <span className="flex size-6 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
            <GitBranch className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-[13px] font-medium text-foreground">Engineering</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">box</span>
        </div>
        <ul className="mt-2.5 list-none space-y-1.5">
          {["API Architecture", "Caching strategy", "Rate limits", "Auth model"].map((t, i) => (
            <li
              key={t}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-foreground/80"
              style={{ background: i === 0 ? "color-mix(in oklab, var(--color-violet-500) 8%, transparent)" : undefined }}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              <span className="truncate">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "connect",
    label: "Connect",
    title: "Connect any agent over MCP",
    body: "Issue a token scoped to the boxes and capabilities an agent should have. OAuth 2.1 + PKCE under the hood — no bespoke integration to maintain.",
    icon: <Plug className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs space-y-2">
        {[
          { name: "Claude", scope: "read · propose", on: true },
          { name: "Cursor", scope: "read", on: true },
          { name: "Custom agent", scope: "read · Engineering", on: true },
        ].map((a) => (
          <div
            key={a.name}
            className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/70 px-3 py-2.5"
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-violet-500/15 text-[11px] font-semibold text-violet-500">
              {a.name.charAt(0)}
            </span>
            <span className="text-[13px] font-medium text-foreground">{a.name}</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">{a.scope}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "propose",
    label: "Propose",
    title: "Changes arrive as reviewable proposals",
    body: "Agents submit diffs, not writes. Review each one in context, then approve, edit, or reject — nothing lands until you say so.",
    icon: <GitPullRequestArrow className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs rounded-2xl border border-border/60 bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
        <p className="mb-1 text-muted-foreground/70">architecture.md</p>
        <p className="rounded bg-red-500/10 px-1.5 text-red-400/80">- Caching: undecided</p>
        <p className="rounded bg-emerald-500/10 px-1.5 text-emerald-500">+ Caching: read-through</p>
        <p className="rounded bg-emerald-500/10 px-1.5 text-emerald-500">+ TTL: 5 minutes</p>
        <div className="mt-2 flex gap-1.5">
          <span className="rounded-md bg-violet-600 px-2 py-1 text-[10px] font-semibold text-white">Approve</span>
          <span className="rounded-md border border-border/70 px-2 py-1 text-[10px] text-muted-foreground">Reject</span>
        </div>
      </div>
    ),
  },
  {
    id: "audit",
    label: "Audit",
    title: "Every change, versioned and reversible",
    body: "An append-only log records every connect, read, proposal, and approval. Full version history means one-click rollback, always.",
    icon: <History className="size-4" aria-hidden="true" />,
    visual: (
      <div className="w-full max-w-xs space-y-0">
        {[
          { who: "You", what: "Approved · architecture.md", t: "now" },
          { who: "Claude", what: "Proposed · architecture.md", t: "2m" },
          { who: "Claude", what: "Read · Engineering", t: "2m" },
          { who: "You", what: "Scoped token issued", t: "1h" },
        ].map((e, i, arr) => (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="size-2 rounded-full bg-violet-500" />
              {i < arr.length - 1 && <span className="w-px flex-1 bg-border/60" />}
            </div>
            <div className="pb-3">
              <p className="text-[12px] font-medium text-foreground">{e.what}</p>
              <p className="font-mono text-[10px] text-muted-foreground/60">
                {e.who} · {e.t}
              </p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

const GOVERNANCE = [
  "Read access never implies write access.",
  "Per-box scopes, enforced at the protocol layer.",
  "Human approval required on every change.",
  "Append-only audit trail, immutable by design.",
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Platform"
        title="Everything your agents need to read. Nothing they can break."
        description="Poggle is a governed context layer: structured markdown knowledge, scoped MCP access, reviewable proposals, and a complete audit trail — in one workspace."
        ctaPrimary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "See how it works", href: "/how-it-works" }}
      />

      {/* Capabilities bento */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="Capabilities"
          title="Everything in one governed workspace."
          lede="The building blocks of a context layer agents can use and you can trust."
        />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {CAPABILITIES.map((c) => {
            const Icon = c.icon;
            return (
              <BentoCard key={c.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
              </BentoCard>
            );
          })}
        </div>
      </MarketingSection>

      {/* Interactive explorer */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader
          eyebrow="See it in action"
          title="One loop, four moves."
          lede="Capture knowledge, connect an agent, review what it proposes, and keep a complete trail."
        />
        <FeatureTabs tabs={TABS} />
      </MarketingSection>

      {/* Governance reinforcement */}
      <MarketingSection className="border-b border-border/30">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeader
            eyebrow="Governance"
            title="Safe by construction, not by policy."
            lede="The trust gate isn't a setting you can forget to turn on. Agents physically cannot write to your source of truth — they can only propose."
          />
          <BentoCard>
            <ul className="list-none space-y-4">
              {GOVERNANCE.map((g) => (
                <li key={g} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
                    <ShieldCheck className="size-3.5 text-violet-500" aria-hidden="true" />
                  </span>
                  <span className="text-[15px] leading-relaxed text-foreground/85">{g}</span>
                </li>
              ))}
            </ul>
          </BentoCard>
        </div>
      </MarketingSection>

      {/* Secondary capabilities strip */}
      <MarketingSection muted className="border-b border-border/30">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[
            { icon: Search, title: "Full-text & semantic search", body: "Agents and humans find the right note by keyword or meaning." },
            { icon: Download, title: "Plain-markdown portability", body: "Export everything, anytime. Your knowledge is never held hostage." },
            { icon: ScrollText, title: "Compliance-ready trail", body: "Every action is attributable, timestamped, and immutable." },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.title} className="flex items-start gap-3">
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <div>
                  <h3 className="font-hero text-base font-semibold text-foreground">{c.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </MarketingSection>

      {/* CTA */}
      <MarketingSection>
        <BentoCard tone="gradient" className="px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -left-10 -top-10 size-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-hero text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Give your agents a workspace they can&apos;t break.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base text-white/80 sm:text-lg">
              Connect your first agent for free and watch the proposals roll in.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="rounded-full bg-white text-violet-700 hover:bg-white/90"
                render={<Link href="/sign_in?mode=signup" />}
              >
                Get started free
                <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="rounded-full text-white hover:bg-white/10 hover:text-white"
                render={<Link href="/pricing" />}
              >
                View pricing
              </Button>
            </div>
            <p className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/70">
              <Check className="size-4" aria-hidden="true" /> Free to start · No credit card required
            </p>
          </div>
        </BentoCard>
      </MarketingSection>
    </div>
  );
}
