import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileText,
  Eye,
  History,
  Code,
  FileCode,
  RefreshCw,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Notes & Files — Atlas",
  description:
    "Markdown notes and code artifacts in one place. Write notes for humans, manage files for machines — all with full version history.",
};

export default function NotesAndFilesPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Notes & Files"
        title="Write notes. Manage code. All in one place."
        description="Notes are markdown documents for humans. Files are code artifacts for machines. Both live side by side in your workspace with full version history."
        ctaPrimary={{ label: "Get started free", href: "/sign_in" }}
      />

      {/* Notes section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Notes
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Markdown native</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Every note is plain markdown. No proprietary formats, no lock-in.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Eye className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Document preview</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Notes render with readable formatting — headings, lists, code blocks, and more.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <History className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Version history</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Every save creates a version. Roll back to any point with one click.
            </p>
          </div>
        </div>
      </section>

      {/* Files section */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Files
          </h2>
          <div className="mt-2 h-0.5 w-12 rounded-full bg-violet-500/50" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <FileCode className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Code artifacts</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              JSON, YAML, Python, TypeScript, SQL, shell scripts — any format you need.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Code className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Source editing</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Files open in a real code editor, not a rich text pretender.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Full lifecycle</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Draft, active, archived, or trashed. Every file has a clear status.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Ready to start writing?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Create notes and files in seconds. No credit card needed.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" render={<Link href="/sign_in" />}>Get started free
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
