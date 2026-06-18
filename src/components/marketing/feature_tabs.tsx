'use client';

import * as React from 'react';
import * as m from 'motion/react-m';
import { AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { tween } from '@/lib/motion';

// ─── Reusable interactive feature explorer ───────────────────────────────────
// A self-driving, clickable tabbed showcase used across the marketing feature
// pages. Content is passed in as serializable React nodes (icon + visual are
// rendered elements, not component refs) so server pages can supply their own
// tabs while the interaction (active tab, auto-advance, crossfade) lives here.

export type FeatureTab = {
  id: string;
  label: string;
  title: string;
  body: string;
  icon: React.ReactNode;
  visual: React.ReactNode;
};

export function FeatureTabs({
  tabs,
  autoMs = 5200,
}: {
  tabs: FeatureTab[];
  autoMs?: number;
}) {
  const [active, setActive] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused || tabs.length < 2) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % tabs.length), autoMs);
    return () => window.clearTimeout(t);
  }, [active, paused, autoMs, tabs.length]);

  const tab = tabs[active]!;

  return (
    <div
      className="mt-12"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t, i) => {
          const isActive = i === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(i)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'group relative flex items-center gap-2 overflow-hidden rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'border-violet-500/40 bg-violet-500/[0.07] text-foreground'
                  : 'border-border/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <span className={cn('shrink-0', isActive ? 'text-violet-500' : 'text-muted-foreground/70')}>
                {t.icon}
              </span>
              {t.label}
              {isActive &&
                (paused ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-violet-500/50" />
                ) : (
                  <m.span
                    key={active}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: autoMs / 1000, ease: 'linear' }}
                    style={{ originX: 0 }}
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-violet-500"
                  />
                ))}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div className="mt-5 overflow-hidden rounded-3xl border border-border/60 bg-card/50 backdrop-blur-sm">
        <div className="grid items-stretch md:grid-cols-2">
          <div className="order-2 p-7 sm:p-10 md:order-1">
            <AnimatePresence mode="wait">
              <m.div
                key={tab.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: tween.normal }}
                exit={{ opacity: 0, y: -10, transition: { duration: 0.1 } }}
              >
                <h3 className="font-hero text-2xl font-bold tracking-tight text-foreground">
                  {tab.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                  {tab.body}
                </p>
              </m.div>
            </AnimatePresence>
          </div>

          <div className="relative order-1 min-h-[17rem] overflow-hidden border-b border-border/50 bg-muted/20 md:order-2 md:border-b-0 md:border-l">
            <AnimatePresence mode="wait">
              <m.div
                key={tab.id}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: tween.normal }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="absolute inset-0 flex items-center justify-center p-8"
              >
                {tab.visual}
              </m.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
