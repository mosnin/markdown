"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mark } from "@/components/brand/logo";
import { CutButton } from "@/components/marketing/cut-button";
import { cn } from "@/lib/utils";

/* ==========================================================================
   The site header, built from ForgeUI header05: a floating bar that tightens
   and takes a border once the page scrolls, a mega menu under Product with a
   promo card, and an accordion sheet on narrow viewports.

   Two things changed from the block. The scrolled bar is a solid raised
   surface rather than a frosted one (anti-slop rule 4), and the scrolled
   state comes from an IntersectionObserver sentinel rather than a scroll
   listener (DESIGN_LANGUAGE §7.3).
   ========================================================================== */

type MenuChild = { title: string; href: string; description: string };
type Promo = { title: string; description: string; href: string };
type NavItem = {
  id: string;
  title: string;
  href: string;
  children?: MenuChild[];
  promo?: Promo;
};

const NAV: NavItem[] = [
  {
    id: "product",
    title: "Product",
    href: "/product",
    children: [
      {
        title: "Handoff briefs",
        href: "/product#briefs",
        description: "The next agent starts knowing what the last one knew.",
      },
      {
        title: "Session log",
        href: "/product#log",
        description: "What every agent did, and what it actually said.",
      },
      {
        title: "Live coordination",
        href: "/product#coordination",
        description: "Several agents on one repo, without collisions.",
      },
      {
        title: "Hooks and MCP",
        href: "/product#hooks",
        description: "Claude Code, Codex, Cursor, CI — capture is automatic.",
      },
    ],
    promo: {
      title: "How it works",
      description:
        "Install the hooks, run your agents, and the context carries itself.",
      href: "/how-it-works",
    },
  },
  { id: "how", title: "How it works", href: "/how-it-works" },
  { id: "pricing", title: "Pricing", href: "/pricing" },
  { id: "docs", title: "Docs", href: "/docs" },
  { id: "security", title: "Security", href: "/security" },
  { id: "about", title: "About", href: "/about" },
];

const GITHUB = "https://github.com/mosnin/poggle";

function useStuck(): [boolean, (node: HTMLDivElement | null) => void] {
  const [stuck, setStuck] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = (node: HTMLDivElement | null): void => {
    observer.current?.disconnect();
    if (!node) return;
    observer.current = new IntersectionObserver(
      ([entry]) => setStuck(!(entry?.isIntersecting ?? true)),
      { threshold: 0 },
    );
    observer.current.observe(node);
  };
  return [stuck, ref];
}

export function MarketingHeader(): ReactNode {
  const [stuck, sentinelRef] = useStuck();
  // The sheet remembers which route it was opened on, so a navigation closes
  // it without an effect writing state: on a new pathname the two disagree.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [accordion, setAccordion] = useState<string | null>(null);
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)): void => {
    const value = typeof next === "function" ? next(open) : next;
    setOpenOn(value ? pathname : null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
      <div className="fixed inset-x-0 top-0 z-50 px-4">
        <header
          data-stuck={stuck || open}
          className={cn(
            "mk-header mx-auto mt-4 flex h-[56px] w-full items-center justify-between px-6",
            "transition-[max-width,background-color,border-color,box-shadow] duration-[var(--dur-4)] ease-[var(--ease-emphasis)]",
            stuck || open
              ? "max-w-[1200px] rounded-12 border border-border bg-raised shadow-elev-2"
              : "max-w-[1360px] border border-transparent bg-transparent",
          )}
        >
          <div className="flex items-center gap-10">
            <Link
              href="/"
              aria-label="Company OS home"
              className="focus-ring-canvas flex items-center gap-4 rounded-4 text-ink focus-visible:outline-none"
            >
              {/* Founder-requested scroll morph. This blur belongs to the
                  wordmark transition, not a glass surface or scroll reveal. */}
              <span
                className="inline-flex shrink-0 items-center"
                data-brand-compact={stuck}
                aria-hidden="true"
              >
                <Mark size={24} />
                <motion.span
                  initial={false}
                  animate={{
                    width: stuck ? 0 : "auto",
                    marginLeft: stuck ? 0 : 8,
                    opacity: stuck ? 0 : 1,
                    filter: reduced || !stuck ? "blur(0px)" : "blur(6px)",
                  }}
                  transition={{
                    duration: reduced ? 0 : 0.26,
                    ease: [0.32, 0.72, 0, 1],
                  }}
                  className="t-brand overflow-hidden whitespace-nowrap"
                >
                  companyos
                </motion.span>
              </span>
            </Link>
            <nav aria-label="Main" className="hidden md:flex">
              <DesktopLinks pathname={pathname} />
            </nav>
          </div>

          <div className="flex items-center gap-5">
            <Link
              href="/sign_in"
              className="t-mk-nav focus-ring-canvas hidden rounded-4 px-4 py-3 text-ink-2 transition-colors duration-[var(--dur-1)] hover:text-ink focus-visible:outline-none md:inline-flex"
            >
              Sign in
            </Link>
            <CutButton href="/sign_in" className="hidden sm:inline-flex">
              Create a company
            </CutButton>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mk-mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className="focus-ring-canvas flex size-[36px] items-center justify-center rounded-6 text-ink transition-colors duration-[var(--dur-1)] hover:bg-state-hover focus-visible:outline-none md:hidden"
            >
              {open ? (
                <X size={20} strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        <AnimatePresence>
          {open ? (
            <motion.div
              id="mk-mobile-menu"
              initial={reduced ? { opacity: 1 } : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
              className="mx-auto mt-2 max-w-[1200px] overflow-hidden rounded-12 border border-border bg-raised shadow-elev-3 md:hidden"
            >
              <div className="flex flex-col p-6">
                {NAV.map((item) => {
                  const isOpen = accordion === item.id;
                  if (!item.children) {
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="t-body-strong border-b border-hairline py-6 text-ink-2 transition-colors duration-[var(--dur-1)] hover:text-ink"
                      >
                        {item.title}
                      </Link>
                    );
                  }
                  return (
                    <div key={item.id} className="border-b border-hairline">
                      <button
                        type="button"
                        onClick={() => setAccordion(isOpen ? null : item.id)}
                        aria-expanded={isOpen}
                        className="t-body-strong flex w-full items-center justify-between py-6 text-ink-2 transition-colors duration-[var(--dur-1)] hover:text-ink"
                      >
                        {item.title}
                        <ChevronDown
                          size={18}
                          strokeWidth={1.5}
                          aria-hidden="true"
                          className={cn(
                            "transition-transform duration-[var(--dur-2)] ease-[var(--ease-move)]",
                            isOpen && "rotate-180",
                          )}
                        />
                      </button>
                      <div
                        className={cn(
                          "grid transition-[grid-template-rows,opacity] duration-[var(--dur-2)] ease-[var(--ease-move)]",
                          isOpen
                            ? "grid-rows-[1fr] opacity-100"
                            : "grid-rows-[0fr] opacity-0",
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="flex flex-col gap-2 pb-5">
                            <Link
                              href={item.href}
                              onClick={() => setOpen(false)}
                              className="rounded-8 px-4 py-4 transition-colors duration-[var(--dur-1)] hover:bg-state-hover"
                            >
                              <span className="t-body-strong block text-ink">
                                Overview
                              </span>
                            </Link>
                            {item.children.map((child) => (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={() => setOpen(false)}
                                className="rounded-8 px-4 py-4 transition-colors duration-[var(--dur-1)] hover:bg-state-hover"
                              >
                                <span className="t-body-strong block text-ink">
                                  {child.title}
                                </span>
                                <span className="t-caption block text-ink-3">
                                  {child.description}
                                </span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noreferrer"
                  className="t-body-strong border-b border-hairline py-6 text-ink-2 transition-colors duration-[var(--dur-1)] hover:text-ink"
                >
                  GitHub
                </a>
                <div className="flex flex-col gap-4 pt-6">
                  <CutButton href="/sign_in">Start free</CutButton>
                  <CutButton href="/sign_in" variant="outline">
                    Sign in
                  </CutButton>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}

function DesktopLinks({ pathname }: { pathname: string }): ReactNode {
  const [active, setActive] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (id: string | null): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActive(id);
  };
  const scheduleClose = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), 120);
  };

  return (
    <div
      onMouseLeave={scheduleClose}
      onMouseEnter={() => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
      }}
      className="relative flex items-center gap-2"
    >
      {NAV.map((item) => {
        const current =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const base = cn(
          "t-mk-nav focus-ring-canvas flex items-center gap-2 rounded-4 px-4 py-3 transition-colors duration-[var(--dur-1)] focus-visible:outline-none",
          current || active === item.id
            ? "text-ink"
            : "text-ink-2 hover:text-ink",
        );
        if (!item.children) {
          return (
            <Link
              key={item.id}
              href={item.href}
              onMouseEnter={() => show(null)}
              onFocus={() => show(null)}
              aria-current={current ? "page" : undefined}
              className={base}
            >
              {item.title}
            </Link>
          );
        }
        return (
          <Link
            key={item.id}
            href={item.href}
            onMouseEnter={() => show(item.id)}
            onFocus={() => show(item.id)}
            aria-current={current ? "page" : undefined}
            aria-expanded={active === item.id}
            className={base}
          >
            {item.title}
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
              className={cn(
                "transition-transform duration-[var(--dur-2)] ease-[var(--ease-move)]",
                active === item.id && "rotate-180",
              )}
            />
          </Link>
        );
      })}
      <a
        href={GITHUB}
        target="_blank"
        rel="noreferrer"
        onMouseEnter={() => show(null)}
        className="t-mk-nav focus-ring-canvas rounded-4 px-4 py-3 text-ink-2 transition-colors duration-[var(--dur-1)] hover:text-ink focus-visible:outline-none"
      >
        GitHub
      </a>
      <AnimatePresence>
        {active ? <MegaMenu key={active} id={active} /> : null}
      </AnimatePresence>
    </div>
  );
}

function MegaMenu({ id }: { id: string }): ReactNode {
  const item = NAV.find((n) => n.id === id);
  const reduced = useReducedMotion();
  if (!item?.children) return null;
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      className={cn(
        "absolute -left-4 top-[44px] origin-top-left rounded-12 border border-border bg-overlay p-2 shadow-elev-3",
        item.promo ? "grid w-[680px] grid-cols-[1fr_232px] gap-2" : "w-[520px]",
      )}
    >
      <div className="flex flex-col gap-1 rounded-8 bg-object p-2 ring-1 ring-hairline">
        {item.children.map((child) => (
          <Link
            key={child.href}
            href={child.href}
            className="focus-ring group flex items-start gap-5 rounded-8 px-4 py-4 transition-colors duration-[var(--dur-1)] hover:bg-state-hover focus-visible:outline-none"
          >
            <span className="flex flex-col gap-1">
              <span className="t-body-strong text-ink">{child.title}</span>
              <span className="t-caption text-ink-3">{child.description}</span>
            </span>
          </Link>
        ))}
      </div>
      {item.promo ? (
        <Link
          href={item.promo.href}
          className="focus-ring group flex flex-col rounded-8 bg-object p-4 ring-1 ring-hairline transition-colors duration-[var(--dur-1)] hover:bg-state-hover focus-visible:outline-none"
        >
          <div className="flex min-h-[112px] flex-1 items-center justify-center text-ink">
            <PromoArt />
          </div>
          <div className="flex flex-col gap-1 px-2 pb-1 pt-4">
            <span className="t-body-strong text-ink">{item.promo.title}</span>
            <span className="t-caption text-ink-3">
              {item.promo.description}
            </span>
          </div>
        </Link>
      ) : null}
    </motion.div>
  );
}

/** header05's "docs" artwork, recoloured to currentColor: three stacked sheets. */
function PromoArt(): ReactNode {
  const w = 56;
  const h = 74;
  const fold = 13;
  const doc = (x: number, y: number): string =>
    `M ${x + 5} ${y} H ${x + w - fold} L ${x + w} ${y + fold} V ${y + h - 5} Q ${x + w} ${y + h} ${x + w - 5} ${y + h} H ${x + 5} Q ${x} ${y + h} ${x} ${y + h - 5} V ${y + 5} Q ${x} ${y} ${x + 5} ${y} Z`;
  const foldPath = (x: number, y: number): string =>
    `M ${x + w - fold} ${y} V ${y + fold} H ${x + w}`;
  const layers = [
    { x: 130, y: 30, op: 0.13, content: false },
    { x: 108, y: 36, op: 0.26, content: false },
    { x: 86, y: 42, op: 0.55, content: true },
  ];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 288 140"
      className="h-auto w-full"
      fill="none"
      stroke="currentColor"
    >
      {layers.map((l, i) => (
        <g key={i}>
          <path
            d={doc(l.x, l.y)}
            fill="var(--surface-object)"
            strokeOpacity={l.op}
            strokeWidth={1.5}
          />
          <path d={foldPath(l.x, l.y)} strokeOpacity={l.op} strokeWidth={1.5} />
          {l.content
            ? [0, 1, 2].map((j) => (
                <line
                  key={j}
                  x1={l.x + 11}
                  y1={l.y + 30 + j * 12}
                  x2={l.x + w - 11 - (j === 2 ? 12 : 0)}
                  y2={l.y + 30 + j * 12}
                  strokeOpacity={0.2}
                  strokeWidth={1.4}
                />
              ))
            : null}
        </g>
      ))}
    </svg>
  );
}
