"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/product/page_header";
import { StepIndicator } from "../_step_indicator";
import { clearProgress, readProgress } from "../_progress";

/**
 * Step 4 — try it.
 *
 * Two side-by-side Cards open Claude and ChatGPT in new tabs so the user
 * can paste the bundle still on their clipboard. Below, a quiet "What
 * just happened?" panel summarizes the journey, and the primary CTA
 * routes to /app, clearing the local progress as we go.
 */
export default function StepFourPage() {
  const router = useRouter();
  const [noteTitle, setNoteTitle] = useState("your note");

  useEffect(() => {
    const progress = readProgress();
    if (!progress.noteId) {
      // No note → progress drifted; bounce to step 2.
      router.replace("/welcome/setup/step_2");
      return;
    }
    setNoteTitle(progress.noteTitle ?? "your note");
  }, [router]);

  function handleFinish() {
    clearProgress();
    router.push("/app");
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Set up Poggle"
        description="Step 4 of 4 — Try it in your AI of choice."
        below={
          <div className="flex items-center justify-between py-3">
            <StepIndicator current={4} />
          </div>
        }
      />

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 space-y-8">
        <div>
          <p className="text-overline text-muted-foreground">Final step</p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
            Paste the bundle into your AI
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your bundle is on the clipboard. Open Claude or ChatGPT, paste
            it, and ask a real question about{" "}
            <span className="font-medium text-foreground">{noteTitle}</span>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="transition-fast hover:shadow-xs">
            <CardHeader>
              <CardTitle>Paste in Claude</CardTitle>
              <CardDescription>
                claude.ai — best for nuanced reasoning over long context.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="default"
                render={
                  <a
                    href="https://claude.ai/new"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                Open Claude
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>

          <Card className="transition-fast hover:shadow-xs">
            <CardHeader>
              <CardTitle>Paste in ChatGPT</CardTitle>
              <CardDescription>
                chat.openai.com — broad capability, fast iteration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="default"
                render={
                  <a
                    href="https://chat.openai.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                Open ChatGPT
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* What just happened? */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />
              What just happened?
            </CardTitle>
            <CardDescription>
              In under five minutes you went from empty workspace to a real,
              auditable AI bundle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {SUMMARY_BULLETS.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2.5">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span className="text-sm leading-relaxed text-foreground">
                    {bullet}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              You can rerun the bundle from any note&apos;s page —{" "}
              <span className="font-medium text-foreground">
                Download bundle (.txt)
              </span>
              .
            </div>
          </CardContent>
        </Card>

        {/* Sticky bottom bar */}
        <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <p className="text-xs text-muted-foreground">
            All set. Your workspace is waiting.
          </p>
          <Button variant="brand" size="lg" onClick={handleFinish}>
            Continue to Poggle
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const SUMMARY_BULLETS = [
  "You created a real box — a focused context domain you can fill in over time.",
  "You wrote a real note that lives in your workspace and is searchable, linkable, and versioned.",
  "You produced a deterministic context bundle — the exact retrieval package an AI agent will see when it asks about this note.",
];
