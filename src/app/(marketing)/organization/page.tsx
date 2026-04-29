import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Archive,
  BookOpen,
  Network,
  FolderTree,
  GripVertical,
  RefreshCw,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Collections & Folders — Atlas",
  description:
    "Organize your work into focused containers. Collections are top-level workspaces, folders give you real structural depth.",
};

export default function OrganizationPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Organization"
        title="Organize your work into focused containers."
        description="Collections are your top-level workspaces — one per project, topic, or domain. Folders give you real structural depth inside each collection."
        ctaPrimary={{ label: "Start organizing", href: "/sign_in" }}
      />

      {/* Collections section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Collections
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Archive className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Focused collections</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Each collection is a self-contained context domain with its own notes, files, skills, and agents.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Guide notes</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Every collection can have a guide note — the first thing AI reads to understand the domain.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Network className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Tree and graph views</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Navigate your collection contents as an interactive tree or explore relationships in the graph.
            </p>
          </div>
        </div>
      </section>

      {/* Folders section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Folders
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FolderTree className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Real structural depth</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Nest folders as deep as you need. Folders are first-class objects, not just names.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <GripVertical className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Drag and drop</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Move items between folders by dragging them in the sidebar tree.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Full lifecycle</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Archive or trash entire folder subtrees. Restore them when you need them.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to organize your knowledge?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Create your first collection in seconds. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>Start organizing
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
