"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/product/page_header";
import { SendToAiPopover } from "@/components/product/send_to_ai_popover";
import { StepIndicator } from "../_step_indicator";
import { readProgress, writeProgress } from "../_progress";

/**
 * Step 3 — Send your first note to your AI.
 *
 * Onboarding now teaches the new "Send to AI" feature directly: users
 * meet the popover here, with sensible first-time defaults (Claude Code
 * + 15 min one-shot read + read-only).
 */
export default function StepThreePage() {
  const router = useRouter();

  const [progress, setProgress] = useState<{
    noteId: string | null;
    noteTitle: string;
  }>({ noteId: null, noteTitle: "My first note" });

  useEffect(() => {
    const stored = readProgress();
    if (!stored.noteId) {
      router.replace("/welcome/setup/step_2");
      return;
    }
    // One-shot localStorage hydration on mount — no cascading renders
    // because the effect only runs once and the state never feeds back
    // into another effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress({
      noteId: stored.noteId,
      noteTitle: stored.noteTitle ?? "My first note",
    });
  }, [router]);

  const noteId = progress.noteId;
  const noteTitle = progress.noteTitle;

  function handleContinue() {
    writeProgress({ step: 4 });
    router.push("/welcome/setup/step_4");
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Set up Poggle"
        description="Step 3 of 4 — Send your note to your AI."
        below={
          <div className="flex items-center justify-between py-3">
            <StepIndicator current={3} />
          </div>
        }
      />

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Send this note to your AI</CardTitle>
            <CardDescription>
              Generate a short-lived link that gives Claude, ChatGPT, or your
              IDE read-only access to this note&apos;s context bundle. The
              link expires automatically — no permanent share, no manual
              copy-paste.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {noteId ? (
                <SendToAiPopover
                  objectType="note"
                  objectId={noteId}
                  objectName={noteTitle}
                  triggerLabel="Send to AI"
                  triggerVariant="default"
                  triggerSize="default"
                  defaultPreferredAi="claude-code"
                  defaultDuration="15m"
                  defaultAllowEdits={false}
                />
              ) : (
                <Button variant="default" size="lg" disabled>
                  Send to AI
                </Button>
              )}
            </div>

            <div className="rounded-md border border-dashed border-border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">
                The popover walks you through every option — pick your AI,
                choose how long the link should live, and whether you want
                the AI to suggest edits as proposals you can review later.
                Default here is <span className="font-medium text-foreground">Claude Code</span>{" "}
                / <span className="font-medium text-foreground">15 minutes</span>{" "}
                / read-only — change it anytime.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Sticky bottom bar */}
        <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-border bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <p className="text-xs text-muted-foreground">
            Once you&apos;ve copied the prompt, head back here to continue.
          </p>
          <Button
            variant="default"
            size="lg"
            onClick={handleContinue}
            disabled={!noteId}
          >
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
