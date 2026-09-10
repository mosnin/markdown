"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as m from "motion/react-m";
import {
  Sparkles,
  Terminal,
  BatteryLow,
  FileText,
  Radio,
  Check,
} from "lucide-react";

import { Onboarding } from "@/components/ui/onboarding";
import { cn } from "@/lib/utils";
import { markOnboarded } from "./actions";

// ─── First-run welcome wizard ────────────────────────────────────────────────
//
// The first thing a new account sees after sign-up. Three short, branded slides
// that orient on the core loop — capture, cap out, hand off — then hand off to
// /app, where the real activation checklist takes over. Shown once per account
// (gated on the onboarded_at metadata flag set on completion or skip). Reuses
// the marketing hero's shader backdrop so the leap from logged-out to logged-in
// feels like one continuous product.

const TOTAL_STEPS = 3;

export function WelcomeOnboarding() {
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);

  const finish = React.useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    // Persist the flag before leaving so the wizard never re-appears, then go.
    await markOnboarded();
    router.replace("/app");
  }, [leaving, router]);

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">

      <m.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
        className="relative w-full max-w-lg"
      >
        <Onboarding
          totalSteps={TOTAL_STEPS}
          onComplete={finish}
          className="gap-7 rounded-3xl border-border/60 bg-card/70 p-7 shadow-2xl shadow-violet-950/20 backdrop-blur-xl sm:p-9"
        >
          {/* Wordmark + progress */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-display text-sm tracking-tight text-foreground">
              <span className="flex size-6 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
                <Sparkles className="size-3.5" aria-hidden="true" />
              </span>
              Poggle
            </span>
            <Onboarding.StepIndicator
              variant="pills"
              className="w-24"
              dotClassName="data-[state=active]:bg-violet-500 data-[state=completed]:bg-violet-500/50"
            />
          </div>

          {/* Slides */}
          <div className="min-h-[19rem]">
            <Onboarding.Step step={1}>
              <Slide
                icon={<Sparkles className="size-6" aria-hidden="true" />}
                title="Welcome to Poggle"
                body="Shared memory for your coding agents. When one runs out of plan, the next one starts knowing what happened."
              >
                <FactRow icon={<Terminal className="size-4" />} label="Works with Claude Code, Codex, and any CLI" />
                <FactRow icon={<Radio className="size-4" />} label="Captures automatically once hooks are installed" />
              </Slide>
            </Onboarding.Step>

            <Onboarding.Step step={2}>
              <Slide
                icon={<BatteryLow className="size-6" aria-hidden="true" />}
                title="One runs out. The next carries on."
                body="Poggle logs what each agent decided, tried and got stuck on — then assembles that into a brief the next agent reads on its first turn."
              >
                <LoopRow n={1} icon={<Radio className="size-4" />} label="Agents log as they work" />
                <LoopRow n={2} icon={<BatteryLow className="size-4" />} label="One hits its usage limit" />
                <LoopRow n={3} icon={<FileText className="size-4" />} label="The next one gets the brief" />
              </Slide>
            </Onboarding.Step>

            <Onboarding.Step step={3}>
              <Slide
                icon={<Terminal className="size-6" aria-hidden="true" />}
                title="Let's capture your first session."
                body="We'll drop you into your workspace with a short checklist: create a relay key, run poggle init in a repository, and start an agent."
              >
                <FactRow tone="emerald" icon={<Check className="size-4" />} label="Free to start — no credit card" />
              </Slide>
            </Onboarding.Step>
          </div>

          {/* Controls */}
          <Onboarding.Navigation
            backLabel="Back"
            nextLabel="Next"
            completeLabel="Enter Poggle"
          />

          <button
            type="button"
            onClick={finish}
            disabled={leaving}
            className="-mt-3 text-center text-xs text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-50"
          >
            Skip for now
          </button>
        </Onboarding>
      </m.div>
    </main>
  );
}

function Slide({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
      className="flex flex-col items-center gap-4 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-400 ring-1 ring-violet-500/20">
        {icon}
      </span>
      <h1 className="font-hero text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h1>
      <p className="max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
        {body}
      </p>
      {children && <div className="mt-2 flex w-full flex-col gap-2">{children}</div>}
    </m.div>
  );
}

function FactRow({
  icon,
  label,
  tone = "violet",
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "violet" | "emerald";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/40 px-4 py-2.5 text-left">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          tone === "emerald"
            ? "bg-emerald-500/12 text-emerald-400"
            : "bg-violet-500/12 text-violet-400",
        )}
      >
        {icon}
      </span>
      <span className="text-sm text-foreground/90">{label}</span>
    </div>
  );
}

function LoopRow({
  n,
  icon,
  label,
}: {
  n: number;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/40 px-4 py-2.5 text-left">
      <span className="font-mono text-xs text-violet-400/70">
        {String(n).padStart(2, "0")}
      </span>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-400">
        {icon}
      </span>
      <span className="text-sm text-foreground/90">{label}</span>
    </div>
  );
}
