'use client';

import * as React from 'react';
import * as m from 'motion/react-m';
import { cn } from '@/lib/utils';
import {
  revealVariants,
  revealTransition,
  revealViewport,
} from '@/components/marketing/reveal';

// ─── Shared marketing section primitives ─────────────────────────────────────
// One vocabulary every marketing page composes from, so the whole logged-out
// site reads as one designed surface: consistent rhythm, rounded "bento"
// cards, mono eyebrows + Space Grotesk headlines. Headers and cards reveal as
// they scroll into view so every page breathes with the same quiet rhythm.

export function MarketingSection({
  children,
  className,
  muted,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'relative px-6 py-20 sm:py-28',
        muted && 'bg-muted/20',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  lede,
  align = 'left',
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <m.div
      className={cn(
        'flex max-w-2xl flex-col gap-4',
        align === 'center' && 'mx-auto items-center text-center',
        className,
      )}
      variants={revealVariants}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      transition={revealTransition}
    >
      {eyebrow && (
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-violet-500">
          {eyebrow}
        </p>
      )}
      <h2 className="font-hero text-balance text-3xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {lede && (
        <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {lede}
        </p>
      )}
    </m.div>
  );
}

/**
 * Rounded "bento" card. `tone="gradient"` renders the violet feature treatment;
 * `tone="plain"` is the glass default with a hover sheen.
 */
export function BentoCard({
  children,
  className,
  tone = 'plain',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'plain' | 'gradient';
}) {
  return (
    <m.div
      className={cn(
        'group relative overflow-hidden rounded-3xl p-6 transition-colors duration-300 sm:p-8',
        tone === 'gradient'
          ? 'bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-xl shadow-violet-600/20'
          : 'border border-border/60 bg-card/50 backdrop-blur-sm hover:border-border hover:bg-card/80 hover:shadow-lg hover:shadow-black/5',
        className,
      )}
      variants={revealVariants}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      transition={revealTransition}
      whileHover={tone === 'plain' ? { y: -2 } : undefined}
    >
      {/* Subtle corner sheen on plain cards */}
      {tone === 'plain' && (
        <div className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-violet-500/[0.07] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
      )}
      <div className="relative">{children}</div>
    </m.div>
  );
}

/**
 * Icon tile used across feature cards — a rounded square in the violet accent
 * (or white-on-glass inside a gradient card).
 */
export function IconTile({
  children,
  tone = 'plain',
  className,
}: {
  children: React.ReactNode;
  tone?: 'plain' | 'gradient';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex size-11 items-center justify-center rounded-2xl',
        tone === 'gradient'
          ? 'bg-white/15 text-white backdrop-blur-sm'
          : 'bg-violet-500/10 text-violet-500',
        className,
      )}
    >
      {children}
    </span>
  );
}
