'use client';

import * as React from 'react';
import { Check, X, FileText, Plus, GitBranch } from 'lucide-react';
import * as m from 'motion/react-m';
import { AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { tween, spring } from '@/lib/motion';

// ─── Interactive trust-gate demo ─────────────────────────────────────────────
//
// The homepage hero's centerpiece: a live miniature of the core Poggle loop.
// An agent proposes a change → it lands in the review queue → you approve or
// reject → the decision drops into an audit ledger. Auto-advances on a timer
// (approving by default), pauses on hover, and is fully drivable by clicking
// Approve / Reject. SSR-stable (renders proposal 0) and motion-reduced-aware
// via the app-wide MotionConfig.

type Decision = 'approved' | 'rejected';

type DiffLine = { kind: 'add' | 'del' | 'ctx'; text: string };

type Proposal = {
  id: string;
  agent: string;
  accent: string; // tailwind text/bg color seed
  verb: string;
  target: string;
  box: string;
  added: number;
  removed: number;
  diff: DiffLine[];
};

const PROPOSALS: Proposal[] = [
  {
    id: 'p1',
    agent: 'Claude',
    accent: 'violet',
    verb: 'Update',
    target: 'API Architecture',
    box: 'Engineering',
    added: 12,
    removed: 3,
    diff: [
      { kind: 'ctx', text: '## Rate limits' },
      { kind: 'add', text: '+ 1,000 requests / min per token' },
      { kind: 'add', text: '+ Burst: 50 / sec, then 429' },
      { kind: 'del', text: '- Legacy per-IP quota note' },
    ],
  },
  {
    id: 'p2',
    agent: 'Cursor',
    accent: 'sky',
    verb: 'New note',
    target: 'Onboarding checklist',
    box: 'Support',
    added: 24,
    removed: 0,
    diff: [
      { kind: 'add', text: '+ 1. Connect your first agent' },
      { kind: 'add', text: '+ 2. Scope it to a box' },
      { kind: 'add', text: '+ 3. Approve a proposal' },
      { kind: 'ctx', text: 'Drafted from 18 support tickets' },
    ],
  },
  {
    id: 'p3',
    agent: 'Claude',
    accent: 'violet',
    verb: 'Append',
    target: 'Pricing FAQ',
    box: 'Go-to-market',
    added: 6,
    removed: 1,
    diff: [
      { kind: 'ctx', text: '### Annual billing' },
      { kind: 'add', text: '+ Save 20% paid yearly' },
      { kind: 'add', text: '+ Switch plans anytime' },
      { kind: 'del', text: '- “Contact us” placeholder' },
    ],
  },
];

const AUTO_MS = 4000;

export function HeroDemo() {
  const [index, setIndex] = React.useState(0);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [paused, setPaused] = React.useState(false);
  const [ledger, setLedger] = React.useState<
    { id: string; target: string; agent: string; decision: Decision }[]
  >([]);

  const proposal = PROPOSALS[index]!;

  const resolve = React.useCallback(
    (d: Decision) => {
      setDecision((current) => {
        if (current) return current; // already resolving this card
        const p = PROPOSALS[index]!;
        // Drop the decision into the ledger, then advance to the next card.
        window.setTimeout(() => {
          setLedger((prev) =>
            [{ id: `${p.id}-${Date.now()}`, target: p.target, agent: p.agent, decision: d }, ...prev].slice(0, 3),
          );
          setIndex((i) => (i + 1) % PROPOSALS.length);
          setDecision(null);
        }, 720);
        return d;
      });
    },
    [index],
  );

  // Auto-advance (approve) unless paused or already resolving.
  React.useEffect(() => {
    if (paused || decision) return;
    const t = window.setTimeout(() => resolve('approved'), AUTO_MS);
    return () => window.clearTimeout(t);
  }, [index, paused, decision, resolve]);

  return (
    <div
      className="relative w-full max-w-md"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Interactive demo: approve an AI agent's proposed change"
    >
      {/* Glow */}
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-violet-600/20 blur-3xl" />

      <div className="rounded-[1.75rem] border border-border/60 bg-card/80 p-2 shadow-2xl shadow-violet-950/10 backdrop-blur-xl">
        <div className="overflow-hidden rounded-[1.4rem] border border-border/50 bg-background/60">
          {/* Window chrome */}
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-400/70" />
              <span className="size-2.5 rounded-full bg-amber-400/70" />
              <span className="size-2.5 rounded-full bg-emerald-400/70" />
            </div>
            <span className="font-mono text-[11px] tracking-tight text-muted-foreground">
              poggle · AI Edits
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Connected
            </span>
          </div>

          {/* Review queue */}
          <div className="px-4 pb-4 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                Pending review
              </span>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-500">
                {PROPOSALS.length - index} in queue
              </span>
            </div>

            <div className="relative min-h-[16.5rem]">
              <AnimatePresence mode="popLayout">
                <m.div
                  key={proposal.id + index}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring.gentle }}
                  exit={{
                    opacity: 0,
                    x: decision === 'approved' ? 40 : -40,
                    scale: 0.96,
                    transition: tween.normal,
                  }}
                  className="relative rounded-2xl border border-border/60 bg-card/80 p-4"
                >
                  {/* Proposer */}
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <AgentAvatar agent={proposal.agent} accent={proposal.accent} />
                      <span className="text-sm font-medium text-foreground">{proposal.agent}</span>
                      <span className="text-xs text-muted-foreground">proposed</span>
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground/60">now</span>
                  </div>

                  {/* Target */}
                  <p className="mt-3 flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                        proposal.verb === 'New note'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-violet-500/10 text-violet-500',
                      )}
                    >
                      {proposal.verb === 'New note' ? (
                        <Plus className="size-3" aria-hidden="true" />
                      ) : (
                        <FileText className="size-3" aria-hidden="true" />
                      )}
                      {proposal.verb}
                    </span>
                    <span className="font-medium text-foreground">{proposal.target}</span>
                  </p>

                  {/* Diff preview */}
                  <div className="mt-3 overflow-hidden rounded-xl border border-border/50 bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                    {proposal.diff.map((line, li) => (
                      <div
                        key={li}
                        className={cn(
                          'truncate',
                          line.kind === 'add' && 'text-emerald-500',
                          line.kind === 'del' && 'text-red-400/80',
                          line.kind === 'ctx' && 'text-muted-foreground/70',
                        )}
                      >
                        {line.text}
                      </div>
                    ))}
                  </div>

                  {/* Stat + box */}
                  <div className="mt-3 flex items-center gap-3 text-[11px]">
                    <span className="font-mono text-emerald-500">+{proposal.added}</span>
                    {proposal.removed > 0 && (
                      <span className="font-mono text-red-400/80">−{proposal.removed}</span>
                    )}
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <GitBranch className="size-3" aria-hidden="true" />
                      {proposal.box}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => resolve('rejected')}
                      disabled={!!decision}
                      className="flex-1 rounded-xl border border-border/70 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => resolve('approved')}
                      disabled={!!decision}
                      className="flex-[1.4] rounded-xl bg-violet-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
                    >
                      Approve &amp; merge
                    </button>
                  </div>

                  {/* Decision overlay */}
                  <AnimatePresence>
                    {decision && (
                      <m.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1, transition: spring.snappy }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70 backdrop-blur-sm"
                      >
                        <span
                          className={cn(
                            'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold',
                            decision === 'approved'
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : 'bg-red-500/15 text-red-400',
                          )}
                        >
                          {decision === 'approved' ? (
                            <>
                              <Check className="size-4" aria-hidden="true" /> Merged
                            </>
                          ) : (
                            <>
                              <X className="size-4" aria-hidden="true" /> Rejected
                            </>
                          )}
                        </span>
                      </m.div>
                    )}
                  </AnimatePresence>
                </m.div>
              </AnimatePresence>
            </div>

            {/* Audit ledger */}
            <div className="mt-3 border-t border-border/40 pt-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">
                Audit trail
              </span>
              <ul className="mt-2 flex list-none flex-col gap-1.5">
                <AnimatePresence initial={false}>
                  {ledger.length === 0 ? (
                    <m.li
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-[11px] text-muted-foreground/50"
                    >
                      Every decision is logged, immutably.
                    </m.li>
                  ) : (
                    ledger.map((entry) => (
                      <m.li
                        key={entry.id}
                        layout
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0, transition: tween.fast }}
                        exit={{ opacity: 0, transition: { duration: 0.1 } }}
                        className="flex items-center gap-2 text-[11px]"
                      >
                        <span
                          className={cn(
                            'flex size-4 items-center justify-center rounded-full',
                            entry.decision === 'approved'
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : 'bg-red-500/15 text-red-400',
                          )}
                        >
                          {entry.decision === 'approved' ? (
                            <Check className="size-2.5" aria-hidden="true" />
                          ) : (
                            <X className="size-2.5" aria-hidden="true" />
                          )}
                        </span>
                        <span className="truncate text-foreground/70">{entry.target}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground/50">
                          {entry.agent}
                        </span>
                      </m.li>
                    ))
                  )}
                </AnimatePresence>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Interactivity cue — this loop is live; invite demo-joiners to drive it */}
      <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
        This loop is live — approve or reject it yourself.
      </p>
    </div>
  );
}

function AgentAvatar({ agent, accent }: { agent: string; accent: string }) {
  return (
    <span
      className={cn(
        'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
        accent === 'sky' ? 'bg-sky-500/15 text-sky-500' : 'bg-violet-500/15 text-violet-500',
      )}
      aria-hidden="true"
    >
      {agent.charAt(0)}
    </span>
  );
}
