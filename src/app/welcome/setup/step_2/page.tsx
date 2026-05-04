"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/product/page_header";
import { useToast } from "@/components/product/toast_provider";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { StepIndicator } from "../_step_indicator";
import { readProgress, writeProgress } from "../_progress";
import { createSetupNoteAction } from "../actions";

/**
 * Step 2 — write or paste a single note.
 *
 * We deliberately use a simplified textarea-in-Card rather than embedding
 * the full CRDT-aware note editor. Pulling the editor in here would drag
 * presence avatars, autosave plumbing, and a heavy bundle of dependencies
 * into a flow that just needs "title + body → save". The user lands on
 * the real editor immediately after onboarding completes.
 *
 * Title and body suggestions come from the chosen starting point so the
 * user has a meaningful prompt instead of a blinking cursor.
 */

const SUGGESTIONS: Record<
  "template" | "import" | "blank",
  { title: string; body: string }
> = {
  template: {
    title: "Decision: pick our state library",
    body: `# Decision: pick our state library

## Context
Three options on the table — Zustand, Redux Toolkit, Jotai.

## Options considered
- **Zustand** — minimal API, hooks-first
- **Redux Toolkit** — official, time-travel devtools
- **Jotai** — atomic, fine-grained re-renders

## Decision
…

## Consequences
…
`,
  },
  import: {
    title: "Imported notes — overview",
    body: `# Imported notes

A landing note describing what you just imported and how it's organized.

- What sources did you import from?
- Which folders matter most for AI retrieval?
- Anything you'd like to clean up later?
`,
  },
  blank: {
    title: "My first note",
    body: `# My first note

Paste anything you'd like an AI to read alongside this note. A meeting
transcript, a problem you're chewing on, a paragraph from a paper.

The next step bundles this for Claude or ChatGPT in one click.
`,
  },
};

export default function StepTwoPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [boxId, setBoxId] = useState<string | null>(null);
  const [startingPoint, setStartingPoint] = useState<
    "template" | "import" | "blank"
  >("blank");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  // On mount: hydrate from progress. If there's no boxId we bounce back
  // to step 1 — you can't write a note without a destination.
  useEffect(() => {
    const progress = readProgress();
    if (!progress.boxId) {
      router.replace("/welcome/setup/step_1");
      return;
    }
    setBoxId(progress.boxId);
    const sp = progress.startingPoint ?? "blank";
    setStartingPoint(sp);
    const seed = SUGGESTIONS[sp];
    setTitle(seed.title);
    setBody(seed.body);
  }, [router]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!boxId) return;
    startTransition(async () => {
      const result = await createSetupNoteAction({
        boxId,
        title,
        markdownContent: body,
      });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      writeProgress({
        step: 3,
        noteId: result.data.noteId,
        noteTitle: title.trim() || "My first note",
        noteSlug: result.data.slug,
      });
      toast("Note saved.", "success");
      router.push("/welcome/setup/step_3");
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Set up Poggle"
        description="Step 2 of 4 — Write or paste a note."
        below={
          <div className="flex items-center justify-between py-3">
            <StepIndicator current={2} />
          </div>
        }
      />

      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Your first note</CardTitle>
            <CardDescription>
              {startingPoint === "blank"
                ? "Paste anything — a meeting note, a problem you're chewing on, a paper paragraph. We'll bundle it next."
                : "We've seeded a starter — edit it however you like, or replace it entirely."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="setup-note-title"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Title
              </label>
              <Input
                id="setup-note-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give the note a clear title"
                autoComplete="off"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="setup-note-body"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Body
              </label>
              <Textarea
                id="setup-note-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="font-mono text-xs leading-relaxed"
                placeholder="Markdown is supported. Anything goes."
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">
                Markdown formatting and frontmatter both work — exactly the
                same as the full editor.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sticky bottom bar — single primary CTA */}
        <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-border bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <p className="text-xs text-muted-foreground">
            We&apos;ll save and continue to bundling.
          </p>
          <Button
            type="submit"
            variant="brand"
            size="lg"
            disabled={pending || !boxId}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Save note and continue
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  );
}
