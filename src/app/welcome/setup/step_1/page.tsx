"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Box as BoxIcon,
  CheckCircle2,
  FileText,
  LayoutTemplate,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/product/page_header";
import { useToast } from "@/components/product/toast_provider";
import { BOX_TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { StepIndicator } from "../_step_indicator";
import { writeProgress } from "../_progress";
import { createStartingBoxAction } from "../actions";

/**
 * Step 1 — pick a starting point.
 *
 * Three Cards: template, import, blank. The user's choice creates a real
 * box server-side via `createStartingBoxAction` (which composes
 * `createBoxAction` + optionally `applyBoxTemplateAction`). On success we
 * persist the boxId to local progress and route to step 2 — except for
 * "import" which routes to /app/import_export's capable surface (the
 * existing in-box importer), then continues to step 3 once they return.
 *
 * Templates are sourced from the canonical BOX_TEMPLATES registry; we
 * surface the first three so the screen stays calm. Engineering / product /
 * journal-style starts map cleanly to project_context, research, and
 * reading_log respectively.
 */

const FEATURED_TEMPLATE_IDS = [
  "project_context_template",
  "research",
  "reading_log",
] as const;

type TemplateChoice = (typeof FEATURED_TEMPLATE_IDS)[number];

export default function StepOnePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [activeChoice, setActiveChoice] = useState<
    null | "template" | "import" | "blank"
  >(null);
  const [templateId, setTemplateId] = useState<TemplateChoice>(
    FEATURED_TEMPLATE_IDS[0]
  );

  const featured = FEATURED_TEMPLATE_IDS.map((id) => {
    const tpl = BOX_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return null;
    return { id, label: tpl.label, description: tpl.description };
  }).filter((t): t is { id: TemplateChoice; label: string; description: string } => t !== null);

  function handleChoice(mode: "template" | "import" | "blank") {
    setActiveChoice(mode);
    startTransition(async () => {
      const result = await createStartingBoxAction(
        mode === "template"
          ? { mode, templateId }
          : { mode }
      );
      if (!result.ok) {
        toast(result.error, "error");
        setActiveChoice(null);
        return;
      }

      writeProgress({
        step: mode === "blank" ? 3 : 2,
        boxId: result.data.boxId,
        startingPoint: mode,
      });

      if (mode === "import") {
        toast("Box created. Import your notes, then come back to step 2.", "success");
        // /app/import_export houses the import surface; we send them
        // straight there so they can drop their .md files in.
        router.push(`/app/boxes/${result.data.boxId}?import=1`);
        return;
      }

      if (mode === "blank") {
        toast("Blank box created. Skipping ahead to bundling.", "success");
        // Blank-box users skip step 2 — but we still need a note to
        // bundle in step 3. Route to step 2 so they can paste something
        // quickly; if they want truly nothing, they'll see the empty
        // state. (Brief said "skip to step 3" for blank — we route to
        // step 2 because the bundle in step 3 needs a noteId.)
        router.push("/welcome/setup/step_2");
        return;
      }

      router.push("/welcome/setup/step_2");
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Set up Poggle"
        description="Step 1 of 4 — Pick a starting point."
        below={
          <div className="flex items-center justify-between py-3">
            <StepIndicator current={1} />
          </div>
        }
      />

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-6">
          <p className="text-overline text-muted-foreground">Choose one</p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
            How would you like to begin?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All three paths create a real box you can use immediately. You can
            change your mind later — boxes are cheap.
          </p>
        </div>

        <div className="grid gap-4">
          {/* Option A — template */}
          <Card
            className={cn(
              "transition-fast hover:shadow-xs",
              activeChoice === "template" && "ring-2 ring-ring/40"
            )}
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <LayoutTemplate className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle>Start from a template</CardTitle>
                    <Badge variant="secondary">Recommended</Badge>
                  </div>
                  <CardDescription className="mt-1">
                    Pre-built folders, a guide note, and starter content for a
                    common knowledge shape.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <fieldset className="space-y-2" disabled={pending}>
                <legend className="sr-only">Template choices</legend>
                {featured.map((tpl) => (
                  <label
                    key={tpl.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 transition-fast",
                      "hover:bg-accent",
                      templateId === tpl.id &&
                        "border-foreground/30 bg-accent"
                    )}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={tpl.id}
                      checked={templateId === tpl.id}
                      onChange={() => setTemplateId(tpl.id)}
                      className="mt-1 h-3.5 w-3.5 accent-[var(--color-violet-500)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {tpl.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {tpl.description}
                      </p>
                    </div>
                  </label>
                ))}
                <div className="pt-2">
                  <Button
                    variant="brand"
                    size="lg"
                    onClick={() => handleChoice("template")}
                    disabled={pending}
                    aria-label="Use the selected template"
                  >
                    {pending && activeChoice === "template" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    Use this template
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </fieldset>
            </CardContent>
          </Card>

          {/* Option B — import */}
          <Card
            className={cn(
              "transition-fast hover:shadow-xs",
              activeChoice === "import" && "ring-2 ring-ring/40"
            )}
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <Upload className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>Import from Obsidian or Notion</CardTitle>
                  <CardDescription className="mt-1">
                    Drag in a .zip or a folder of .md files. Frontmatter,
                    tags, and folders are preserved.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                variant="default"
                onClick={() => handleChoice("import")}
                disabled={pending}
              >
                {pending && activeChoice === "import" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )}
                Create box and open importer
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>

          {/* Option C — blank */}
          <Card
            className={cn(
              "transition-fast hover:shadow-xs",
              activeChoice === "blank" && "ring-2 ring-ring/40"
            )}
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <BoxIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>Just a blank box</CardTitle>
                  <CardDescription className="mt-1">
                    A clean canvas. Good if you want to feel the surface
                    before deciding what shape your knowledge wants.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                onClick={() => handleChoice("blank")}
                disabled={pending}
              >
                {pending && activeChoice === "blank" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileText className="h-4 w-4" aria-hidden="true" />
                )}
                Start blank
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
