import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Box,
  FileText,
  Layers,
  Link2,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * First-run onboarding callout.
 *
 * Shown on the home page when the workspace has no boxes yet.
 * Explains the core mental model in product-specific language and
 * prompts the user toward the guided four-step setup at /welcome/setup,
 * which ships them a real first AI bundle in under five minutes.
 *
 * Six concepts taught: Box, Folder, Note, Guide note, Explicit links,
 * Context bundle.
 *
 * Server component — no client state needed.
 */

const concepts = [
  {
    icon: Box,
    term: "Box",
    description:
      "A focused context domain. One box per project, topic, or area of knowledge.",
  },
  {
    icon: Layers,
    term: "Folder",
    description:
      "Optional structure inside a box. Folders organize notes — they don't change retrieval semantics.",
  },
  {
    icon: FileText,
    term: "Note",
    description:
      "Markdown content with a title, tags, and optional summary. Notes are the primary unit of context.",
  },
  {
    icon: BookOpen,
    term: "Guide note",
    description:
      "One note per box that orients retrieval. AI agents read this first. Keep it current and concise.",
  },
  {
    icon: Link2,
    term: "Explicit links",
    description:
      "Directed semantic relationships between notes. Connect context with a type and an explanation. Not backlinks.",
  },
  {
    icon: Search,
    term: "Context bundle",
    description:
      "A bounded retrieval package assembled from a note and its linked context. Deterministic and auditable.",
  },
];

export function OnboardingCallout() {
  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Heading */}
      <div className="border-b border-border px-6 py-5">
        <h2 className="text-base font-semibold text-foreground">
          Welcome to Poggle
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Poggle is a structured context workspace for humans and AI
          agents. Content is organized around a clear information hierarchy.
        </p>
      </div>

      {/* Mental model */}
      <div className="px-6 py-5">
        <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          The information hierarchy
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {concepts.map(({ icon: Icon, term, description }) => (
            <div key={term} className="flex gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{term}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Starter actions — funnel into the guided setup */}
      <div className="rounded-b-xl border-t border-border bg-muted/30">
        <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              Ship your first AI bundle in under five minutes
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A guided four-step flow: pick a starting point, write a note,
              bundle it for{" "}
              <Link
                href="/welcome/setup"
                className="brand-underline font-medium text-foreground"
              >
                Claude or GPT
              </Link>
              , and try it. No detours.
            </p>
          </div>
          <div className="shrink-0">
            <Button
              variant="brand"
              size="lg"
              render={<Link href="/welcome/setup" />}
            >
              Start setup
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2.5 border-t border-border px-6 py-3">
          <Upload
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-xs text-muted-foreground/70">
            Have existing notes?{" "}
            <span className="text-muted-foreground">
              The setup flow includes an Obsidian / Notion import path —
              pick &ldquo;Import&rdquo; on the first screen.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
