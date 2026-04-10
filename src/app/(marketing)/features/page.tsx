import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Archive,
  ArrowLeftRight,
  Layers,
  Search,
  FileText,
  Upload,
  Zap,
  Cpu,
  TrendingUp,
  Download,
  Sparkles,
  Code,
  History,
  GitMerge,
  RotateCcw,
  ClipboardList,
  FolderDown,
  Bell,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { FeatureCard } from "@/components/ui/grid-feature-cards";
import { GridCard } from "@/components/ui/grid-card";

export const metadata: Metadata = {
  title: "Features — Poggle",
  description:
    "Everything you need to organize knowledge and build perfect AI context. Boxes, bundles, version history, and more.",
};

const CATEGORIES = [
  {
    id: "organization",
    title: "Knowledge Organization",
    features: [
      {
        icon: Archive,
        title: "Semantic Boxes",
        description:
          "Group notes into topic containers with built-in guides. Every box has a purpose — not just a name.",
      },
      {
        icon: ArrowLeftRight,
        title: "Bidirectional Links",
        description:
          "Link notes to each other. Poggle tracks both directions automatically so nothing gets lost.",
      },
      {
        icon: Layers,
        title: "Nested Structure",
        description:
          "Boxes can contain sub-boxes, mirroring the real hierarchy of your thinking without imposing rigidity.",
      },
      {
        icon: Search,
        title: "Full-Text Search",
        description:
          "Instant search across every note, box, and link. Find anything in under 100ms no matter how large your vault grows.",
      },
      {
        icon: FileText,
        title: "Markdown Native",
        description:
          "Write in standard markdown. Every note is a plain `.md` file — portable, durable, and renderable anywhere.",
      },
      {
        icon: Upload,
        title: "Import & Export",
        description:
          "Import from Obsidian vaults, Notion exports, or any ZIP of markdown files. Export everything at any time.",
      },
    ],
  },
  {
    id: "ai",
    title: "AI Integration",
    features: [
      {
        icon: Zap,
        title: "Context Bundles",
        description:
          "Select notes, set a token budget, export a clean bundle. One click gives your AI exactly the right context.",
      },
      {
        icon: Cpu,
        title: "Token-Aware Packing",
        description:
          "Poggle trims, prioritizes, and fits your notes into any model's context window without overflow.",
      },
      {
        icon: TrendingUp,
        title: "Freshness Scoring",
        description:
          "Recently updated notes score higher in bundle assembly. Your AI always works with the most current knowledge.",
      },
      {
        icon: Download,
        title: "Multi-Format Export",
        description:
          "Export bundles as markdown, JSON, or plain text. Pipe directly into any API or paste into any chat interface.",
      },
      {
        icon: Sparkles,
        title: "System Guide Generation",
        description:
          "Auto-generate box-level guides that summarize the purpose and contents of each knowledge container.",
      },
      {
        icon: Code,
        title: "API Access",
        description:
          "Integrate Poggle into your own AI pipelines via REST API or MCP. Build custom retrieval and bundling workflows.",
      },
    ],
  },
  {
    id: "history",
    title: "History & Audit",
    features: [
      {
        icon: History,
        title: "Full Version History",
        description:
          "Every save creates a version. Browse, diff, and restore any prior state of any note.",
      },
      {
        icon: GitMerge,
        title: "Diff Viewer",
        description:
          "Side-by-side diff between any two versions. See exactly what changed, when, and — in team mode — by whom.",
      },
      {
        icon: RotateCcw,
        title: "One-Click Rollback",
        description:
          "Restore any note to any prior version instantly. No confirmation ceremony — just undo and continue.",
      },
      {
        icon: ClipboardList,
        title: "Audit Log",
        description:
          "Immutable record of every create, edit, delete, and export action. Essential for compliance and team accountability.",
      },
      {
        icon: FolderDown,
        title: "Snapshot Export",
        description:
          "Export a point-in-time snapshot of your entire vault. Archive it, back it up, or hand it off.",
      },
      {
        icon: Bell,
        title: "Change Notifications",
        description:
          "Get notified when a note in a shared box changes — so your team's knowledge stays synchronized.",
      },
    ],
  },
];

function CategorySection({
  category,
}: {
  category: (typeof CATEGORIES)[number];
}) {
  return (
    <section id={category.id} className="py-16">
      <div className="mb-8">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {category.title}
        </h2>
        <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
      </div>
      <div className="grid grid-cols-1 divide-x divide-y divide-dashed border border-dashed sm:grid-cols-2 lg:grid-cols-3">
        {category.features.map((f) => (
          <FeatureCard key={f.title} feature={f} />
        ))}
      </div>
    </section>
  );
}

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <PageHeroSection
        eyebrow="Features"
        title={<>Everything you need to build<br className="hidden sm:block" /> perfect AI context</>}
        description="Poggle combines structured note-taking, token-aware AI bundling, and full version history into one focused context layer."
        ctaPrimary={{ label: "Start free trial", href: "/sign_in" }}
        ctaSecondary={{ label: "View pricing", href: "/pricing" }}
      />

      {/* Anchor nav */}
      <div className="sticky top-[68px] z-30 border-b border-border/50 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-6">
          <nav className="flex gap-1 overflow-x-auto py-2">
            {CATEGORIES.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {c.title}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* Highlights grid */}
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            {
              icon: Archive,
              title: "Semantic Boxes",
              description:
                "Group notes into purpose-built containers. Every box ships with a guide so your AI always knows what's inside.",
            },
            {
              icon: Zap,
              title: "Context Bundles",
              description:
                "Assemble token-perfect bundles for any model in one click. Freshness scoring surfaces the most current notes first.",
            },
            {
              icon: History,
              title: "Full Version History",
              description:
                "Every save creates a version. Browse, diff, and restore any prior state of any note — no confirmation ceremony.",
            },
            {
              icon: FileText,
              title: "Open by Default",
              description:
                "Plain markdown files, portable forever. Export your entire vault as a ZIP at any time with no friction.",
            },
          ].map(({ icon: Icon, title, description }) => (
            <GridCard key={title} className="min-h-40">
              <Icon className="relative size-6 text-foreground/80" strokeWidth={1.5} />
              <div className="relative">
                <span className="text-foreground/80 text-sm font-medium">{title}</span>
                <p className="text-muted-foreground mt-1 text-xs">{description}</p>
              </div>
            </GridCard>
          ))}
        </div>
      </div>

      {/* Feature categories */}
      <div className="mx-auto max-w-5xl px-6">
        {CATEGORIES.map((cat) => (
          <CategorySection key={cat.id} category={cat} />
        ))}
      </div>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to organize your knowledge?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Everything above is available on the free plan. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Link
              href="/sign_in"
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
            >
              Get started for free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <ul className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              {[
                "Free plan forever",
                "Import from Obsidian",
                "No vendor lock-in",
              ].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-violet-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
