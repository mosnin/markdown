import { connection } from "next/server";
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
import { Button } from "@/components/ui/button";
import { FeatureCard } from "@/components/ui/grid-feature-cards";
import { GridCard } from "@/components/ui/grid-card";

export const metadata: Metadata = {
  title: "Features — Poggle",
  description:
    "Everything you need to organize knowledge and build AI-ready context. Notes, files, skills, agents, and more.",
};

const CATEGORIES = [
  {
    id: "organization",
    title: "Organization & Structure",
    features: [
      {
        icon: Archive,
        title: "Boxes",
        description:
          "Focused containers for your projects and topics. Each box has notes, files, skills, agents, and folders.",
      },
      {
        icon: Layers,
        title: "Folders",
        description:
          "Real structural containers with full lifecycle. Nest as deep as you need, drag and drop in the sidebar tree.",
      },
      {
        icon: FileText,
        title: "Notes",
        description:
          "Markdown documents with readable preview, version history, and semantic links. The primary human content type.",
      },
      {
        icon: Code,
        title: "Files",
        description:
          "Non-markdown code artifacts — JSON, YAML, Python, TypeScript, SQL, and more. Real source editing, not rich text.",
      },
      {
        icon: Search,
        title: "Full-Text Search",
        description:
          "Instant search across every object in a box. Weighted by title, tags, and content with deterministic ranking.",
      },
      {
        icon: Upload,
        title: "Import & Export",
        description:
          "Import from Obsidian or any ZIP of markdown files. Export boxes, folders, or individual objects at any time.",
      },
    ],
  },
  {
    id: "ai",
    title: "Skills, Agents & AI",
    features: [
      {
        icon: Zap,
        title: "Skills",
        description:
          "Reusable modules with one canonical source and many supporting files. Share across boxes by reference.",
      },
      {
        icon: Cpu,
        title: "Agents",
        description:
          "Structured orchestrators with type, model hint, system prompt, skill references, and full child structure.",
      },
      {
        icon: ArrowLeftRight,
        title: "Semantic Links",
        description:
          "Connect any object to any other with ten typed relationships. Explicit and directed, not inferred backlinks.",
      },
      {
        icon: Download,
        title: "Context Bundles",
        description:
          "Assemble token-aware bundles of notes and files. Export for any AI model in one click.",
      },
      {
        icon: Sparkles,
        title: "Write Proposals",
        description:
          "External agents propose changes to your content. You approve or reject. No unsupervised machine edits.",
      },
      {
        icon: Code,
        title: "API & MCP Access",
        description:
          "REST API for programmatic access. MCP adapter for native AI agent integration. Scoped connection tokens.",
      },
    ],
  },
  {
    id: "history",
    title: "History, Trust & Lifecycle",
    features: [
      {
        icon: History,
        title: "Full Version History",
        description:
          "Every save creates an immutable version for notes, files, skills, and agents. Browse, diff, and restore.",
      },
      {
        icon: GitMerge,
        title: "Diff Viewer",
        description:
          "Side-by-side diff between any two versions. See exactly what changed and when.",
      },
      {
        icon: RotateCcw,
        title: "One-Click Rollback",
        description:
          "Restore any object to any prior version instantly. Works for all versioned object types.",
      },
      {
        icon: ClipboardList,
        title: "Audit Log",
        description:
          "Append-only immutable record of every action — creates, edits, lifecycle changes, and machine writes.",
      },
      {
        icon: FolderDown,
        title: "Lifecycle Controls",
        description:
          "Draft, active, archived, trashed. Every object has a clear status with full subtree operations for folders.",
      },
      {
        icon: Bell,
        title: "Realtime Updates",
        description:
          "Changes appear instantly across the app via push-based realtime. No manual refresh needed.",
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

export default async function FeaturesPage() {
  await connection();
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <PageHeroSection
        eyebrow="Features"
        title={<>Everything you need to organize<br className="hidden sm:block" /> knowledge for AI</>}
        description="Poggle brings notes, files, skills, and agents together in one structured context store with semantic links, version history, and full API access."
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
              title: "Five Object Types",
              description:
                "Notes, files, skills, agents, and folders — each with its own editor, lifecycle, and version history.",
            },
            {
              icon: Zap,
              title: "Skills & Agents",
              description:
                "Reusable modules and orchestrators with real multi-file package structure, not just single-file wrappers.",
            },
            {
              icon: History,
              title: "Full Version History",
              description:
                "Every save creates a version across all object types. Browse, diff, and restore any prior state instantly.",
            },
            {
              icon: FileText,
              title: "Open by Default",
              description:
                "Plain markdown, portable forever. Export boxes, folders, or individual objects as structured ZIPs at any time.",
            },
          ].map(({ icon: Icon, title, description }) => (
            <GridCard key={title} patternSeed={title} className="min-h-40">
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
            <Button size="lg" render={<Link href="/sign_in" />}>Get started for free
              <ArrowRight className="h-4 w-4" /></Button>
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
