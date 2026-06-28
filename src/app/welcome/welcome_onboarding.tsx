"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as m from "motion/react-m";
import {
  Sparkles,
  Plug,
  GitPullRequestArrow,
  ShieldCheck,
  Eye,
  Check,
} from "lucide-react";

import { Onboarding } from "@/components/ui/onboarding";
import { HeroBackdrop } from "@/components/marketing/hero_backdrop";
import { cn } from "@/lib/utils";
import { markOnboarded } from "./actions";

// ─── First-run welcome wizard ────────────────────────────────────────────────
//
// The first thing a new account sees after sign-up. Three short, branded slides
// that orient on the core loop — connect, propose, approve — then hand off to
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
      <HeroBackdrop />

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
                body="A governed context layer for your AI agents — a workspace they can read, and a trust gate they can't cross."
              >
                <FactRow icon={<Eye className="size-4" />} label="Agents get rich read access" />
                <FactRow icon={<ShieldCheck className="size-4" />} label="Every write waits for your approval" />
              </Slide>
            </Onboarding.Step>

            <Onboarding.Step step={2}>
              <Slide
                icon={<GitPullRequestArrow className="size-6" aria-hidden="true" />}
                title="Agents propose. You approve."
                body="Agents connect over MCP and submit changes as reviewable diffs. Nothing touches your source of truth until you say so."
              >
                <LoopRow n={1} icon={<Plug className="size-4" />} label="Connect an agent over MCP" />
                <LoopRow n={2} icon={<GitPullRequestArrow className="size-4" />} label="It proposes a diff" />
                <LoopRow n={3} icon={<Check className="size-4" />} label="You approve & merge" />
              </Slide>
            </Onboarding.Step>

            <Onboarding.Step step={3}>
              <Slide
                icon={<ShieldCheck className="size-6" aria-hidden="true" />}
                title="Let's connect your first agent."
                body="We'll drop you into your workspace with a short checklist: connect an agent, scope its access, and approve your first proposal."
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
