"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Loader2,
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
import { useToast } from "@/components/product/toast_provider";
import { type ContextBundle } from "@/server/domain/types/context_bundle";
import { StepIndicator } from "../_step_indicator";
import { readProgress, writeProgress } from "../_progress";
import { assembleSetupBundleAction } from "../actions";

/**
 * Step 3 — bundle for an AI.
 *
 * Triggers `assembleSetupBundleAction` (which delegates to the canonical
 * `assembleContextBundleAction` used by `BundleExportButton`) and then
 * formats the result as plain markdown identical to the official bundle
 * download. The text is copied to the clipboard and shown in a
 * `bg-card font-mono text-xs <pre>` so the user can read what's about to
 * land in their AI's chat window.
 */
export default function StepThreePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState<string>("My first note");
  const [noteSlug, setNoteSlug] = useState<string>("note");
  const [bundleText, setBundleText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const progress = readProgress();
    if (!progress.noteId) {
      router.replace("/welcome/setup/step_2");
      return;
    }
    setNoteId(progress.noteId);
    setNoteTitle(progress.noteTitle ?? "My first note");
    setNoteSlug(progress.noteSlug ?? "note");
  }, [router]);

  function handleBundle() {
    if (!noteId) return;
    startTransition(async () => {
      const result = await assembleSetupBundleAction(noteId);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      const text = formatBundleAsMarkdown(result.data, noteTitle);
      setBundleText(text);
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast("Bundle copied to clipboard.", "success");
          setTimeout(() => setCopied(false), 2000);
        }
      } catch {
        toast("Bundle ready — copy it from the panel below.", "info");
      }
    });
  }

  function handleDownload() {
    if (!bundleText) return;
    const blob = new Blob([bundleText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bundle-${noteSlug}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function handleContinue() {
    writeProgress({ step: 4 });
    router.push("/welcome/setup/step_4");
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Set up Poggle"
        description="Step 3 of 4 — Bundle for an AI."
        below={
          <div className="flex items-center justify-between py-3">
            <StepIndicator current={3} />
          </div>
        }
      />

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Bundle this note for Claude or GPT</CardTitle>
            <CardDescription>
              We&apos;ll assemble your note plus its guide note and any linked
              context into a single deterministic markdown package, then copy
              it to your clipboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="brand"
                size="lg"
                onClick={handleBundle}
                disabled={pending || !noteId}
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                {bundleText ? "Re-bundle and copy" : "Bundle this note for Claude / GPT"}
              </Button>
              {bundleText && (
                <>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={handleDownload}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download .txt
                  </Button>
                  <span className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-success" aria-hidden="true" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        Ready to paste
                      </>
                    )}
                  </span>
                </>
              )}
            </div>

            {bundleText ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Bundle preview
                </p>
                <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs leading-relaxed text-foreground">
                  {bundleText}
                </pre>
                <p className="text-xs text-muted-foreground">
                  This is the exact text that just landed on your clipboard.
                  Identical to what{" "}
                  <span className="font-medium text-foreground">Download bundle</span>{" "}
                  produces in the note view.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Click the button above to assemble and preview the bundle.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sticky bottom bar */}
        <div className="sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t border-border bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <p className="text-xs text-muted-foreground">
            {bundleText
              ? "Bundle ready. Open Claude or GPT next."
              : "Bundle the note before continuing."}
          </p>
          <Button
            variant="default"
            size="lg"
            onClick={handleContinue}
            disabled={!bundleText}
          >
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Formatting (mirrors NoteBundleExportButton) ─────────────────────────────

function formatBundleAsMarkdown(bundle: ContextBundle, noteTitle: string): string {
  const lines: string[] = [];

  lines.push(`# Context Bundle: ${noteTitle}`);
  lines.push(`Assembled: ${new Date().toISOString()}`);
  if (bundle.truncated) {
    lines.push("(Bundle was truncated due to size limits)");
  }
  lines.push("");

  lines.push("---");
  lines.push(`## [PRIMARY] ${bundle.target_note.title}`);
  lines.push(`Path: ${bundle.target_note.path_cache}`);
  lines.push("");
  if (bundle.target_note.summary) lines.push(bundle.target_note.summary);
  lines.push("");

  if (bundle.guide_note) {
    lines.push("---");
    lines.push(`## [GUIDE] ${bundle.guide_note.title}`);
    lines.push("");
    if (bundle.guide_note.summary) lines.push(bundle.guide_note.summary);
    lines.push("");
  }

  if (bundle.ancestor_summary_note) {
    lines.push("---");
    lines.push(`## [ANCESTOR SUMMARY] ${bundle.ancestor_summary_note.title}`);
    lines.push("");
    if (bundle.ancestor_summary_note.summary)
      lines.push(bundle.ancestor_summary_note.summary);
    lines.push("");
  }

  for (const linked of bundle.linked_notes) {
    lines.push("---");
    lines.push(`## [LINKED] ${linked.title} (${linked.relationship_type})`);
    lines.push("");
    if (linked.summary) lines.push(linked.summary);
    lines.push("");
  }

  return lines.join("\n");
}
