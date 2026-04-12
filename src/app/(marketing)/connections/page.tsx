import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  List,
  Unlink,
  MessageSquare,
  Move,
  Shapes,
  Eye,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Connections — Poggle",
  description:
    "Connect your knowledge with typed relationships. Every object can link to any other with explicit semantics, visible in an interactive graph.",
};

export default function ConnectionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Connections"
        title="Connect your knowledge with typed relationships."
        description="Every object in Poggle can link to any other with explicit semantic relationships. See the full picture in the interactive graph."
        ctaPrimary={{ label: "Start connecting", href: "/sign_in" }}
      />

      {/* Semantic links section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Semantic links
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <List className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Ten relationship types</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Related, depends on, extends, parent of, derived from — pick the one that fits.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Unlink className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Cross-type linking</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Link notes to files, skills to agents, folders to anything. Not just note-to-note.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Directed and annotated</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Every link has a direction and optional annotation for context.
            </p>
          </div>
        </div>
      </section>

      {/* Graph view section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Graph view
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Move className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Interactive visualization</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Pan, zoom, click, and explore your knowledge graph in real time.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Shapes className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">All object types</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Notes, files, skills, agents, and folders all appear as nodes with typed edges.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Eye className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Read-only by design</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              The graph is for understanding structure, not editing it — changes happen in the tree.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to connect your knowledge?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Build your first graph in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Link
              href="/sign_in"
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
            >
              Start connecting
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
