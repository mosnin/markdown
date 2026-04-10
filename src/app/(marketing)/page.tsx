import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";

// ─── Data ─────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "⬡",
    title: "Structured Boxes",
    description:
      "Organize notes into semantic containers with guides, not flat folders. Every box has a purpose and a shape.",
  },
  {
    icon: "⚡",
    title: "AI Context Bundles",
    description:
      "Export exactly the right notes for your AI conversation. Control token count, freshness, and relevance.",
  },
  {
    icon: "⟳",
    title: "Version History",
    description:
      "Every note tracks its own history. Roll back to any version, compare diffs, audit every change.",
  },
];

const STATS = [
  { value: "10k+", label: "Notes created" },
  { value: "99.9%", label: "Uptime SLA" },
  { value: "2.4×", label: "Faster AI responses" },
  { value: "<100ms", label: "Note retrieval" },
];

const SPLITS = [
  {
    eyebrow: "Organization",
    headline: "Knowledge that knows its own shape",
    body: "Boxes aren't just folders — they're semantic containers with built-in guides, custom schemas, and relationship-aware linking. Your notes understand context the way you do.",
    bullets: [
      "Box-level guides define the purpose of every container",
      "Bidirectional links surface related knowledge automatically",
      "Nested boxes mirror the real structure of your thinking",
    ],
    visual: (
      <div className="rounded-xl border border-border/60 bg-card p-4 font-mono text-xs leading-relaxed">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
          <span className="ml-2 text-muted-foreground">context-store</span>
        </div>
        <div className="space-y-1 text-muted-foreground">
          <p>
            <span className="text-violet-400">⬡</span>{" "}
            <span className="text-foreground">Architecture</span>
          </p>
          <p className="pl-4">
            ├── <span className="text-foreground">system_design.md</span>
          </p>
          <p className="pl-4">
            ├── <span className="text-foreground">api_contracts.md</span>
          </p>
          <p className="pl-4">
            └── <span className="text-foreground">data_flow.md</span>
          </p>
          <p className="mt-2">
            <span className="text-violet-400">⬡</span>{" "}
            <span className="text-foreground">Decisions</span>
          </p>
          <p className="pl-4">
            ├── <span className="text-foreground">caching_strategy.md</span>
          </p>
          <p className="pl-4">
            └── <span className="text-foreground">auth_approach.md</span>
          </p>
          <p className="mt-2">
            <span className="text-violet-400">⬡</span>{" "}
            <span className="text-foreground">References</span>
          </p>
          <p className="pl-4">
            └── <span className="text-foreground">external_apis.md</span>
          </p>
        </div>
      </div>
    ),
  },
  {
    eyebrow: "AI Integration",
    headline: "Package context the way your AI thinks",
    body: "Stop copy-pasting into chat. Context Store assembles the right notes, trims to your token budget, and exports a clean bundle for any AI model. One click. Perfect context.",
    bullets: [
      "Token-aware bundling keeps you under model limits",
      "Freshness scoring surfaces recently updated notes first",
      "Export as markdown, JSON, or plain text for any workflow",
    ],
    visual: (
      <div className="rounded-xl border border-border/60 bg-card p-4 font-mono text-xs leading-relaxed">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
          <span className="ml-2 text-muted-foreground">context_bundle.json</span>
        </div>
        <div className="space-y-1">
          <p>
            <span className="text-violet-400">📦</span>{" "}
            <span className="text-foreground font-medium">AI Refactoring Bundle</span>
          </p>
          <p className="text-muted-foreground">
            ──────────────────────────
          </p>
          <p>
            <span className="text-green-400">✓</span>{" "}
            <span className="text-foreground">system_design.md</span>{" "}
            <span className="text-muted-foreground">840 tok</span>
          </p>
          <p>
            <span className="text-green-400">✓</span>{" "}
            <span className="text-foreground">api_contracts.md</span>{" "}
            <span className="text-muted-foreground">612 tok</span>
          </p>
          <p>
            <span className="text-green-400">✓</span>{" "}
            <span className="text-foreground">auth_approach.md</span>{" "}
            <span className="text-muted-foreground">440 tok</span>
          </p>
          <p className="text-muted-foreground">──────────────────────────</p>
          <p>
            <span className="text-violet-400">⚡</span>{" "}
            <span className="text-foreground">3 notes</span>{" "}
            <span className="text-muted-foreground">· 1,892 / 4,096 tokens</span>
          </p>
        </div>
      </div>
    ),
  },
  {
    eyebrow: "History & Audit",
    headline: "Nothing is ever truly deleted",
    body: "Every edit is tracked. Every version is restorable. Context Store maintains a complete audit trail so you can understand how your knowledge evolved — and undo anything.",
    bullets: [
      "Diff view shows exactly what changed between versions",
      "One-click rollback to any prior state",
      "Full audit log for compliance and team accountability",
    ],
    visual: (
      <div className="rounded-xl border border-border/60 bg-card p-4 font-mono text-xs leading-relaxed">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
          <span className="ml-2 text-muted-foreground">version history</span>
        </div>
        <div className="space-y-2">
          {[
            { v: "v4", time: "2 min ago", label: "current", color: "text-green-400" },
            { v: "v3", time: "1 hr ago", label: "added caching notes", color: "text-muted-foreground" },
            { v: "v2", time: "yesterday", label: "initial draft", color: "text-muted-foreground" },
            { v: "v1", time: "3 days ago", label: "created", color: "text-muted-foreground" },
          ].map((row) => (
            <div key={row.v} className="flex items-center gap-3">
              <span className="w-5 text-violet-400">{row.v}</span>
              <span className={row.color}>{row.label}</span>
              <span className="ml-auto text-muted-foreground/60">{row.time}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Start organizing your knowledge.",
    features: ["100 notes", "3 boxes", "Basic export", "7-day history"],
    cta: "Get started free",
    href: "/sign_in",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$12",
    period: "per month",
    description: "For serious knowledge workers.",
    features: [
      "Unlimited notes",
      "Unlimited boxes",
      "AI context bundles",
      "Full version history",
      "API access",
    ],
    cta: "Start free trial",
    href: "/sign_in",
    highlight: true,
  },
  {
    name: "Team",
    price: "$39",
    period: "per month",
    description: "Shared context for collaborative teams.",
    features: [
      "Everything in Pro",
      "Shared workspaces",
      "Team audit log",
      "SSO / SAML",
      "Priority support",
    ],
    cta: "Contact sales",
    href: "/contact",
    highlight: false,
  },
];

const FAQS = [
  {
    q: "What is a 'box'?",
    a: "A box is a semantic container for related notes — like a topic, project, or knowledge domain. Unlike folders, boxes have guides that define their purpose and shape, so your notes always fit their context.",
  },
  {
    q: "How do context bundles work?",
    a: "You select a set of notes (or let Context Store recommend them), set a token budget, and export. The bundle is a clean markdown or JSON file ready to paste into any AI conversation or API call.",
  },
  {
    q: "Is my data private?",
    a: "Your notes are stored encrypted at rest and in transit. We don't use your content to train models. You own your data and can export everything at any time.",
  },
  {
    q: "What AI models can I use it with?",
    a: "Any model that accepts text input — Claude, GPT-4, Gemini, local models via Ollama, and anything with an API. Context Store is model-agnostic by design.",
  },
  {
    q: "Can I import my existing notes?",
    a: "Yes. Context Store imports plain markdown files, Obsidian vaults, Notion exports, and standard ZIP archives. Your existing knowledge migrates in minutes.",
  },
];

// ─── Sections ─────────────────────────────────────────────────────────────────

function HeroBadge() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
      <span className="text-xs font-medium text-violet-400">Now in public beta</span>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative w-full max-w-lg">
      {/* Glow */}
      <div className="absolute -inset-4 rounded-3xl bg-violet-600/10 blur-2xl" />
      <div className="relative rounded-2xl border border-border/60 bg-card shadow-2xl shadow-black/20">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
          <span className="ml-3 font-mono text-xs text-muted-foreground">
            architecture.md — Context Store
          </span>
        </div>
        {/* Content */}
        <div className="grid grid-cols-5 divide-x divide-border/50">
          {/* Sidebar */}
          <div className="col-span-2 p-3 font-mono text-[11px]">
            <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">
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
                className={`mb-1 flex items-center gap-1.5 rounded px-1.5 py-1 ${
                  box.active
                    ? "bg-violet-500/15 text-violet-400"
                    : "text-muted-foreground"
                }`}
              >
                <span className="text-[10px]">⬡</span>
                <span>{box.name}</span>
              </div>
            ))}
          </div>
          {/* Editor area */}
          <div className="col-span-3 p-3 font-mono text-[11px] text-muted-foreground">
            <p className="mb-2 font-semibold text-foreground"># System Design</p>
            <p className="text-violet-400/80">## Overview</p>
            <p className="mt-1">The API layer sits between the</p>
            <p>client and the database, handling</p>
            <p>auth, rate limiting, and routing.</p>
            <p className="mt-2 text-violet-400/80">## Key Components</p>
            <p className="mt-1">- <span className="text-foreground">Auth middleware</span></p>
            <p>- <span className="text-foreground">Context engine</span></p>
            <p>- <span className="text-foreground">Version store</span></p>
          </div>
        </div>
        {/* Footer bar */}
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            v12 · 2 min ago
          </span>
          <span className="rounded bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-400">
            ⚡ Bundle ready
          </span>
        </div>
      </div>
    </div>
  );
}

function LogoStrip() {
  const logos = ["Vercel", "Linear", "Raycast", "Arc", "Cursor", "Zed"];
  return (
    <section className="border-y border-border/50 bg-muted/20 py-8">
      <div className="mx-auto max-w-5xl px-6">
        <p className="mb-6 text-center text-xs uppercase tracking-widest text-muted-foreground/60">
          Trusted by teams at
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8">
          {logos.map((name) => (
            <span
              key={name}
              className="font-mono text-sm font-semibold tracking-tight text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCards() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-violet-400">
            Why Context Store
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Your AI is only as good as its context
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Most teams lose knowledge to chat logs and random folders. Context
            Store gives it structure.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border/60 bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-lg text-violet-400">
                {f.icon}
              </div>
              <h3 className="mb-1.5 font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsBand() {
  return (
    <section className="border-y border-border/50 bg-muted/20 py-12">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {s.value}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureSplits() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-5xl space-y-24 px-6">
        {SPLITS.map((split, i) => (
          <div
            key={split.eyebrow}
            className={`flex flex-col gap-12 lg:flex-row lg:items-center ${
              i % 2 === 1 ? "lg:flex-row-reverse" : ""
            }`}
          >
            {/* Text */}
            <div className="flex-1 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
                {split.eyebrow}
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {split.headline}
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                {split.body}
              </p>
              <ul className="space-y-2">
                {split.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            {/* Visual */}
            <div className="flex-1">{split.visual}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section className="border-y border-border/50 bg-muted/20 py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-violet-400">
            Pricing
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Start free. Upgrade when you need more.
          </p>
        </div>
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
              <p className="text-sm font-semibold text-foreground">{plan.name}</p>
              <p className="mt-2">
                <span className="text-3xl font-bold tracking-tight text-foreground">
                  {plan.price}
                </span>
                <span className="ml-1 text-sm text-muted-foreground">
                  {plan.period}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.href}
                className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-colors ${
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
          All plans include a 14-day free trial. No credit card required.
        </p>
      </div>
    </section>
  );
}

function FAQSection() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-2xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Frequently asked questions
          </h2>
        </div>
        <div className="divide-y divide-border/60">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
                {faq.q}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="border-t border-border/50 py-20">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Start building your context brain
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          Free forever. No credit card required. Import your existing notes in minutes.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/sign_in"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
          >
            Get started for free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/features"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            See all features
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Join 10,000+ knowledge workers already using Context Store.
        </p>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-32 lg:pt-40">
        <div className="flex flex-col items-center gap-12 lg:flex-row lg:items-start lg:gap-16">
          {/* Left: text */}
          <div className="flex-1 space-y-6 text-center lg:text-left">
            <HeroBadge />
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Your second brain{" "}
              <span className="bg-gradient-to-r from-violet-400 to-violet-600 bg-clip-text text-transparent">
                for AI.
              </span>
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
              Context Store is a markdown-native operating system for structured
              knowledge. Organize your notes, bundle perfect context for AI, and
              never lose a decision again.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row lg:items-start">
              <Link
                href="/sign_in"
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
              >
                Start for free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/features"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                See how it works →
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              Free forever · No credit card · Import from Obsidian in minutes
            </p>
          </div>
          {/* Right: visual */}
          <div className="flex flex-1 justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </div>
      </section>

      <LogoStrip />
      <FeatureCards />
      <StatsBand />
      <FeatureSplits />
      <PricingSection />
      <FAQSection />
      <FinalCTA />
    </div>
  );
}
