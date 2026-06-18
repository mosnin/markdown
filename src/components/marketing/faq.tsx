'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Accessible FAQ accordion. Uses the grid-rows 0fr→1fr technique for a smooth,
// JS-measurement-free height transition; the first item opens by default.

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <div className="divide-y divide-border/50 overflow-hidden rounded-3xl border border-border/60 bg-card/40">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={it.q}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="text-[15px] font-medium text-foreground">{it.q}</span>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-300',
                  isOpen && 'rotate-180 text-violet-500',
                )}
                aria-hidden="true"
              />
            </button>
            <div
              className={cn(
                'grid px-6 transition-[grid-template-rows] duration-300 ease-out',
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <p className="pb-5 text-[14px] leading-relaxed text-muted-foreground">{it.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
