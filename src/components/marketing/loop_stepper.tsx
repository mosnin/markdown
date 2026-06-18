'use client';

import * as React from 'react';
import {
  BookOpen,
  GitPullRequestArrow,
  Plug,
  ShieldCheck,
  Check,
  FileText,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import * as m from 'motion/react-m';
import { AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { tween } from '@/lib/motion';

// ─── Interactive "the loop" stepper ──────────────────────────────────────────
// The four-step governed loop as a self-driving, clickable stepper: each step
// shows its detail plus a small live visual. Auto-advances, pauses on hover,
// and is fully clickable. Self-contained (owns its icons) so it can be dropped
// into the server-rendered home page.

type Step = { n: string; label: string; title: string; body: string; icon: LucideIcon };

const STEPS: Step[] = [
  {
    n: '01',
    label: 'Connect',
    title: 'Connect over MCP',
    body: 'Any MCP-capable agent connects to your workspace with a scoped token. One protocol, no bespoke integrations to maintain.',
    icon: Plug,
  },
  {
    n: '02',
    label: 'Read',
    title: 'Read your context',
    body: 'Agents read the notes, files, and decisions that matter — the same source of truth your team works from, always current.',
    icon: BookOpen,
  },
  {
    n: '03',
    label: 'Propose',
    title: 'Propose changes',
    body: 'Agents never write directly. Every change arrives as a proposal — a reviewable diff against your workspace.',
    icon: GitPullRequestArrow,
  },
  {
    n: '04',
    label: 'Approve',
    title: 'You approve',
    body: 'A human reviews and approves before anything lands. The trust gate stays closed until you open it.',
    icon: ShieldCheck,
  },
];

const DURATION = 3600;

export function LoopStepper() {
  const [active, setActive] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(
      () => setActive((a) => (a + 1) % STEPS.length),
      DURATION,
    );
    return () => window.clearTimeout(t);
  }, [active, paused]);

  const step = STEPS[active]!;

  return (
    <div
      className="mt-12"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Rail */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const isActive = i === active;
          const Icon = s.icon;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setActive(i)}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'group relative overflow-hidden rounded-2xl border p-4 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'border-violet-500/40 bg-violet-500/[0.06]'
                  : 'border-border/60 bg-card/40 hover:bg-card/70',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-xl transition-colors',
                    isActive ? 'bg-violet-500/15 text-violet-500' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="font-mono text-[11px] text-muted-foreground/50">{s.n}</span>
              </div>
              <p
                className={cn(
                  'mt-2.5 text-sm font-medium transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </p>
              {/* Auto-advance progress */}
              {isActive &&
                (paused ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-violet-500/50" />
                ) : (
                  <m.span
                    key={active}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: DURATION / 1000, ease: 'linear' }}
                    style={{ originX: 0 }}
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-violet-500"
                  />
                ))}
            </button>
          );
        })}
      </div>

      {/* Active panel */}
      <div className="mt-4 overflow-hidden rounded-3xl border border-border/60 bg-card/50 backdrop-blur-sm">
        <div className="grid items-stretch md:grid-cols-2">
          <div className="p-7 sm:p-10">
            <AnimatePresence mode="wait">
              <m.div
                key={active}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: tween.normal }}
                exit={{ opacity: 0, y: -10, transition: { duration: 0.1 } }}
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-violet-500">
                  Step {step.n}
                </span>
                <h3 className="mt-3 font-hero text-2xl font-bold tracking-tight text-foreground">
                  {step.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </m.div>
            </AnimatePresence>
          </div>

          <div className="relative min-h-[16rem] overflow-hidden border-t border-border/50 bg-muted/20 md:border-l md:border-t-0">
            <AnimatePresence mode="wait">
              <m.div
                key={active}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: tween.normal }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="absolute inset-0 flex items-center justify-center p-8"
              >
                <StepVisual index={active} />
              </m.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Per-step visuals ────────────────────────────────────────────────────────

function StepVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="flex w-full max-w-xs items-center justify-between gap-2">
        <Chip label="Agent" />
        <div className="flex flex-1 flex-col items-center gap-1">
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] text-violet-500">
            scoped token
          </span>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
        </div>
        <Chip label="Workspace" violet />
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="w-full max-w-xs space-y-2">
        {['Architecture decisions', 'Pricing model', 'Onboarding flow'].map((t, i) => (
          <div
            key={t}
            className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/70 px-3 py-2.5"
            style={{ opacity: 1 - i * 0.18 }}
          >
            <FileText className="size-4 shrink-0 text-violet-500" aria-hidden="true" />
            <span className="truncate text-[13px] text-foreground/80">{t}</span>
          </div>
        ))}
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="w-full max-w-xs rounded-xl border border-border/60 bg-card/70 p-3 font-mono text-[11px] leading-relaxed">
        <p className="text-muted-foreground/70">## Caching</p>
        <p className="rounded bg-red-500/10 px-1.5 text-red-400/80">- strategy: undecided</p>
        <p className="rounded bg-emerald-500/10 px-1.5 text-emerald-500">+ strategy: read-through</p>
        <p className="rounded bg-emerald-500/10 px-1.5 text-emerald-500">+ ttl: 5 minutes</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500">
        <Check className="size-8" aria-hidden="true" />
      </div>
      <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
        Merged to source of truth
      </span>
    </div>
  );
}

function Chip({ label, violet }: { label: string; violet?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-2xl border px-4 py-3',
        violet ? 'border-violet-500/30 bg-violet-500/10' : 'border-border/60 bg-card/70',
      )}
    >
      <ArrowRight className={cn('size-4', violet ? 'text-violet-500' : 'text-muted-foreground')} aria-hidden="true" />
      <span className="text-[11px] font-medium text-foreground/80">{label}</span>
    </div>
  );
}
