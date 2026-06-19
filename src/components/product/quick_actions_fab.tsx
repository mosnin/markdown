"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as m from "motion/react-m";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { Plus, GitPullRequestArrow, Plug, Package } from "lucide-react";

import { cn } from "@/lib/utils";
import { spring, tween } from "@/lib/motion";

// ─── Quick-actions FAB ───────────────────────────────────────────────────────
//
// A single morphing surface, fixed bottom-right across the whole app. Collapsed
// it's a violet disc that also carries an ambient badge for the pending-review
// count — so "you have N AI edits waiting" is glanceable from any page. Tapped,
// it springs open into a small stack of the highest-value jumps (review queue,
// connect an agent, new box), staggered in, dismissed by the scrim or Esc.
// Reduced-motion users get the same surface without the spring.

type QuickAction = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  accent?: boolean;
};

export function QuickActionsFab({
  pendingProposalsCount = 0,
}: {
  pendingProposalsCount?: number;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = React.useState(false);

  const actions: QuickAction[] = [
    {
      label: "Review AI Edits",
      href: "/app/proposals",
      icon: GitPullRequestArrow,
      badge: pendingProposalsCount,
      accent: true,
    },
    { label: "Connect an agent", href: "/app/connect", icon: Plug },
    { label: "New box", href: "/app/dashboard", icon: Package },
  ];

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      {/* Dismiss scrim */}
      <AnimatePresence>
        {open && (
          <m.div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tween.fast}
            className="fixed inset-0 z-40 bg-background/40 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-6 right-6 z-[45] flex flex-col items-end gap-3">
        {/* Expanded action stack */}
        <AnimatePresence>
          {open && (
            <m.ul
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                visible: { transition: { staggerChildren: 0.04 } },
                hidden: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
              }}
              className="flex list-none flex-col items-end gap-2"
            >
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <m.li
                    key={action.href}
                    variants={{
                      hidden: { opacity: 0, y: 8, scale: 0.9 },
                      visible: { opacity: 1, y: 0, scale: 1, transition: spring.snappy },
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => go(action.href)}
                      className="group flex items-center gap-3 rounded-full border border-border/60 bg-card/90 py-2 pl-4 pr-2 text-sm font-medium text-foreground shadow-lg shadow-black/10 backdrop-blur-md transition-colors hover:bg-card"
                    >
                      <span className="whitespace-nowrap">{action.label}</span>
                      {action.badge ? (
                        <span className="rounded-full bg-violet-500/15 px-1.5 text-xs font-semibold text-violet-500">
                          {action.badge > 99 ? "99+" : action.badge}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                          action.accent
                            ? "bg-violet-600 text-white"
                            : "bg-muted text-foreground/80 group-hover:bg-violet-500/15 group-hover:text-violet-500",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                    </button>
                  </m.li>
                );
              })}
            </m.ul>
          )}
        </AnimatePresence>

        {/* Toggle */}
        <m.button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "Close quick actions" : "Open quick actions"}
          whileTap={{ scale: 0.92 }}
          className="relative flex size-14 items-center justify-center rounded-full bg-violet-600 text-white shadow-xl shadow-violet-900/30 outline-none ring-violet-400/40 transition-colors hover:bg-violet-500 focus-visible:ring-4"
        >
          <m.span
            animate={{ rotate: open ? 135 : 0 }}
            transition={reduceMotion ? { duration: 0 } : spring.snappy}
            className="flex"
          >
            <Plus className="size-6" aria-hidden="true" />
          </m.span>
          {!open && pendingProposalsCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[11px] font-bold text-white ring-2 ring-background">
              {pendingProposalsCount > 99 ? "99+" : pendingProposalsCount}
            </span>
          )}
        </m.button>
      </div>
    </>
  );
}
