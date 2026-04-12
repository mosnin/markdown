import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileDown,
  FolderOpen,
  AlertTriangle,
  Archive,
  FolderDown,
  Link2,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "Import & Export — Poggle",
  description:
    "Portable packages you own forever. Import from Obsidian or any markdown source. Export any box, folder, or note as a structured zip.",
};

export default function PortabilityPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Import & Export"
        title="Portable packages you own forever."
        description="Import from Obsidian or any markdown source. Export any box, folder, or note as a structured zip with manifest and full history."
        ctaPrimary={{ label: "Start importing", href: "/sign_in" }}
      />

      {/* Import section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Import
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FileDown className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Markdown import</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Drop in a zip of markdown files. Poggle creates notes, folders, and links automatically.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FolderOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Obsidian compatible</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Import your Obsidian vault with structure preserved.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Collision handling</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Skip, rename, or overwrite when imported content overlaps with existing.
            </p>
          </div>
        </div>
      </section>

      {/* Export section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Export
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Archive className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Box export</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Download an entire box as a zip with all notes, folders, links, and a manifest.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FolderDown className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Folder export</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Export just one folder and its descendants — scoped and clean.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Link2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Signed downloads</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Export links are signed and valid for one hour. No permanent storage URLs.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to take control of your data?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Import your existing notes in minutes. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Link
              href="/sign_in"
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
            >
              Start importing
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
