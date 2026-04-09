import { BookOpen, Box, FileText, Layers, Search } from "lucide-react";
import { CreateBoxDialog } from "@/components/product/create_box_dialog";

/**
 * First-run onboarding callout.
 *
 * Shown on the home page when the workspace has no boxes yet.
 * Explains the core mental model in product-specific language and
 * prompts the user toward their first meaningful action.
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
          Welcome to Context Store
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Context Store is a structured context workspace for humans and AI
          agents. It is not a generic notes app — content is organized around
          a clear information hierarchy.
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
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* First action */}
      <div className="border-t border-border bg-muted/30 rounded-b-xl px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Create your first box
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Start with a box for a project, research area, or knowledge domain.
              You can choose a template to get started faster.
            </p>
          </div>
          <div className="shrink-0">
            <CreateBoxDialog />
          </div>
        </div>
      </div>
    </div>
  );
}
