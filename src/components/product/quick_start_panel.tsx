"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, LayoutTemplate, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Quick start panel for sparse workspaces.
 *
 * Shown on the workspace home when boxes exist but contain no notes yet.
 * Teaches the three most useful first actions: import existing content,
 * start from a note template, create a guide note.
 *
 * Now also surfaces a "Continue setup →" affordance when localStorage
 * indicates the user is mid-flow in /welcome/setup. We promoted this to
 * a client component so we can read that progress key without a profile
 * column. The original three-action layout is preserved for the steady
 * state where no setup is in flight.
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

const SETUP_STORAGE_KEY = "poggle_setup_progress";

interface StoredProgress {
  step?: number;
}

export function QuickStartPanel({ firstBox }: QuickStartPanelProps) {
  const [setupStep, setSetupStep] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SETUP_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredProgress;
      if (
        parsed &&
        typeof parsed.step === "number" &&
        parsed.step >= 1 &&
        parsed.step <= 4
      ) {
        setSetupStep(parsed.step);
      }
    } catch {
      // ignore parse failures
    }
  }, []);

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

      {/* In-flight setup banner — only when localStorage says we are mid-flow. */}
      {setupStep !== null && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-brand/10 px-6 py-3">
          <div className="flex items-start gap-2">
            <Sparkles
              className="mt-0.5 h-4 w-4 shrink-0 text-brand"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-foreground">
                Setup is still in progress
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You&apos;re on step {setupStep} of 4 in the guided onboarding.
                Pick up where you left off.
              </p>
            </div>
          </div>
          <Button
            variant="brand"
            size="sm"
            render={<Link href="/welcome/setup" />}
          >
            Continue setup
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      )}

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
