import Link from "next/link";
import { ArrowRight, BookOpen, LayoutTemplate, Upload } from "lucide-react";

/**
 * Quick start panel for sparse workspaces.
 *
 * Shown on the workspace home when boxes exist but contain no notes yet.
 * Teaches the three most useful first actions: import existing content,
 * start from a note template, create a guide note.
 *
 * Server component — no client state. All actions link to the first box
 * where the full action surface is available (Import button, New note dialog,
 * guide note assignment in the context panel).
 */

interface QuickStartPanelProps {
  firstBox: { id: string; name: string };
}

const STARTER_ACTIONS = [
  {
    icon: Upload,
    iconClassName: "text-muted-foreground",
    title: "Import existing content",
    description:
      "Use the Import button in the box header to bring in .md files or .zip packages. Supports four collision modes.",
  },
  {
    icon: LayoutTemplate,
    iconClassName: "text-muted-foreground",
    title: "Start from a note template",
    description:
      "Use New note and choose a starter template — prompt, agent, system, or guide note. Templates pre-populate structured content.",
  },
  {
    icon: BookOpen,
    iconClassName: "text-amber-600/70 dark:text-amber-500/70",
    title: "Create a guide note",
    description:
      "A guide note orients AI retrieval for a box. AI agents read it first. Assign one from the context panel on the right side of the box page.",
  },
] as const;

export function QuickStartPanel({ firstBox }: QuickStartPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Get started</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your boxes are ready — here are three ways to start populating them.
          </p>
        </div>
        <Link
          href={`/app/boxes/${firstBox.id}`}
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-fast hover:text-foreground"
          aria-label={`Open box ${firstBox.name}`}
        >
          Open {firstBox.name}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-border" role="list">
        {STARTER_ACTIONS.map(({ icon: Icon, iconClassName, title, description }) => (
          <li key={title} className="flex items-start gap-3 px-6 py-4">
            <Icon
              className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`}
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
