'use client';

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Building2,
  ChevronDown,
  Code2,
  Download,
  FileText,
  GitBranch,
  LayoutGrid,
  LifeBuoy,
  Moon,
  Network,
  Plug,
  Puzzle,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react';
import * as m from 'motion/react-m';
import { AnimatePresence } from 'motion/react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { cn } from '@/lib/utils';
import { staggerContainer, fadeRise, tween, spring } from '@/lib/motion';

// ─── Navigation model ────────────────────────────────────────────────────────
// Real, specific copy — this is the trust-gate / governed-context-layer story,
// not placeholder nav. Each mega menu pairs a column of destinations with one
// featured tile that carries the section's headline idea.

type MegaItem = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

type Featured = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: LucideIcon;
};

type MegaMenu = {
  key: string;
  label: string;
  items: MegaItem[];
  featured: Featured;
};

const MEGA_MENUS: MegaMenu[] = [
  {
    key: 'product',
    label: 'Product',
    items: [
      { title: 'Platform overview', description: 'The whole context layer, end to end.', href: '/features', icon: LayoutGrid },
      { title: 'Notes & files', description: 'Markdown-native knowledge, kept structured.', href: '/notes-and-files', icon: FileText },
      { title: 'Skills & agents', description: 'Reusable capabilities your agents can call.', href: '/skills-and-agents', icon: Puzzle },
      { title: 'Organization', description: 'Boxes, branches, and a live knowledge graph.', href: '/organization', icon: Boxes },
      { title: 'Portability', description: 'Plain markdown — yours to export anytime.', href: '/portability', icon: Download },
    ],
    featured: {
      eyebrow: 'The trust gate',
      title: 'Approve every agent write',
      description: 'Agents propose changes over MCP. Nothing touches your source of truth until you say so.',
      href: '/how-it-works',
      cta: 'See the loop',
      icon: ShieldCheck,
    },
  },
  {
    key: 'developers',
    label: 'Developers',
    items: [
      { title: 'How it works', description: 'Propose → review → approve, in detail.', href: '/how-it-works', icon: GitBranch },
      { title: 'Connections', description: 'Connect any MCP agent with scoped tokens.', href: '/connections', icon: Plug },
      { title: 'API', description: 'Build directly on the governed context layer.', href: '/api', icon: Code2 },
    ],
    featured: {
      eyebrow: 'Model Context Protocol',
      title: 'One protocol, no bespoke glue',
      description: 'OAuth 2.1 + PKCE, per-box scopes, full audit. Bring the agents you already use.',
      href: '/connections',
      cta: 'Connect an agent',
      icon: Network,
    },
  },
  {
    key: 'resources',
    label: 'Resources',
    items: [
      { title: 'Blog', description: 'Notes on context engineering.', href: '/blog', icon: BookOpen },
      { title: 'Changelog', description: 'What shipped, and what’s next.', href: '/changelog', icon: Rocket },
      { title: 'Help center', description: 'Guides, FAQs, and support.', href: '/help', icon: LifeBuoy },
      { title: 'About', description: 'Why we’re building Poggle.', href: '/about', icon: Building2 },
    ],
    featured: {
      eyebrow: 'Get started free',
      title: 'Your first agent in minutes',
      description: 'Spin up a workspace, connect an agent, and watch the proposals roll in.',
      href: '/sign_in',
      cta: 'Start free',
      icon: Sparkles,
    },
  },
];

const DIRECT_LINKS: { label: string; href: string }[] = [
  { label: 'Pricing', href: '/pricing' },
];

// ─── Header ──────────────────────────────────────────────────────────────────

export function MarketingHeader() {
  const [active, setActive] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const scrolled = useScroll(8);
  const pathname = usePathname();
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = React.useRef<HTMLDivElement | null>(null);

  // Close everything on route change.
  React.useEffect(() => {
    setActive(null);
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the full-page mobile menu is open.
  React.useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  // Escape closes the mega menu; click-outside collapses it.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setActive(null);
        setMobileOpen(false);
      }
    }
    function onClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setActive(null);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onClick);
    };
  }, []);

  function openMenu(key: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActive(key);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), 140);
  }

  const activeMenu = MEGA_MENUS.find((mm) => mm.key === active) ?? null;

  return (
    <header className="pointer-events-none sticky top-0 z-50 w-full">
      <div className="mx-auto flex w-full max-w-6xl justify-center px-4 pt-2.5">
        <div ref={navRef} className="pointer-events-auto relative w-full md:w-fit">
          {/* ── The pill ─────────────────────────────────────────────────── */}
          <nav
            className={cn(
              'relative flex h-12 items-center justify-between gap-2 rounded-full px-2 md:gap-7',
              'backdrop-blur-xl transition-[background-color,box-shadow] duration-300',
              scrolled
                ? 'bg-background/80 shadow-[0_12px_40px_-14px_rgba(0,0,0,0.35)]'
                : 'bg-background/55 shadow-[0_6px_24px_-18px_rgba(0,0,0,0.25)]',
            )}
          >
            {/* Left: logo + nav, grouped together */}
            <div className="flex items-center gap-1">
              <Link
                href="/"
                className="flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors hover:bg-accent/60"
                onMouseEnter={() => setActive(null)}
              >
                <WordmarkLogo />
              </Link>

              <ul className="hidden items-center gap-0.5 md:flex">
              {MEGA_MENUS.map((mm) => {
                const isOpen = active === mm.key;
                return (
                  <li
                    key={mm.key}
                    onMouseEnter={() => openMenu(mm.key)}
                    onMouseLeave={scheduleClose}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-haspopup="true"
                      onClick={() => setActive(isOpen ? null : mm.key)}
                      onFocus={() => openMenu(mm.key)}
                      className={cn(
                        'flex items-center gap-1 rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isOpen
                          ? 'bg-accent text-foreground'
                          : 'text-foreground/75 hover:bg-accent/60 hover:text-foreground',
                      )}
                    >
                      {mm.label}
                      <ChevronDown
                        className={cn(
                          'size-3.5 text-foreground/40 transition-transform duration-200',
                          isOpen && 'rotate-180 text-foreground/70',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
              {DIRECT_LINKS.map((link) => (
                <li key={link.href} onMouseEnter={() => setActive(null)}>
                  <Link
                    href={link.href}
                    className="rounded-full px-3.5 py-2 text-sm font-medium text-foreground/75 transition-colors hover:bg-accent/60 hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            </div>

            {/* Desktop CTAs */}
            <div className="hidden items-center gap-1 md:flex">
              <ThemeToggleButton />
              <Link
                href="/sign_in"
                className="rounded-full px-3.5 py-2 text-sm font-medium text-foreground/75 transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                Sign in
              </Link>
              <Button
                size="sm"
                className="rounded-full"
                render={<Link href="/sign_in?mode=signup" />}
              >
                Get started
              </Button>
            </div>

            {/* Mobile trigger */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setMobileOpen((v) => !v)}
              className="rounded-full md:hidden"
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              aria-label="Toggle menu"
            >
              <MenuToggleIcon open={mobileOpen} className="size-5" duration={300} />
            </Button>
          </nav>

          {/* ── Mega menu panel ──────────────────────────────────────────── */}
          <AnimatePresence>
            {activeMenu && (
              <m.div
                key="mega"
                initial={{ opacity: 0, y: 8, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99, transition: tween.fast }}
                transition={spring.gentle}
                onMouseEnter={() => openMenu(activeMenu.key)}
                onMouseLeave={scheduleClose}
                className="absolute left-1/2 top-[calc(100%+0.6rem)] hidden w-[44rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 md:block"
              >
                <div className="overflow-hidden rounded-[1.75rem] border border-border/60 bg-popover/85 p-2.5 shadow-2xl shadow-black/10 backdrop-blur-2xl">
                  <div className="grid grid-cols-5 gap-2">
                    {/* Destination column */}
                    <AnimatePresence mode="wait">
                      <m.ul
                        key={activeMenu.key}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0, transition: tween.fast }}
                        exit={{ opacity: 0, x: 6, transition: { duration: 0.08 } }}
                        className="col-span-3 flex list-none flex-col gap-0.5"
                      >
                        {activeMenu.items.map((item) => {
                          const Icon = item.icon;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className="group/item flex items-start gap-3 rounded-2xl p-3 transition-colors hover:bg-accent"
                              >
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500 transition-colors group-hover/item:bg-violet-500/15">
                                  <Icon className="size-[18px]" aria-hidden="true" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-foreground">
                                    {item.title}
                                  </span>
                                  <span className="block text-[13px] leading-snug text-muted-foreground">
                                    {item.description}
                                  </span>
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </m.ul>
                    </AnimatePresence>

                    {/* Featured tile */}
                    <AnimatePresence mode="wait">
                      <m.div
                        key={activeMenu.key}
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0, transition: tween.fast }}
                        exit={{ opacity: 0, x: -6, transition: { duration: 0.08 } }}
                        className="col-span-2"
                      >
                        <FeaturedTile featured={activeMenu.featured} />
                      </m.div>
                    </AnimatePresence>
                  </div>
                </div>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Full-page mobile menu ──────────────────────────────────────────── */}
      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </header>
  );
}

// ─── Featured tile ─────────────────────────────────────────────────────────

function FeaturedTile({ featured }: { featured: Featured }) {
  const Icon = featured.icon;
  return (
    <Link
      href={featured.href}
      className="group/feat relative flex h-full flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 to-violet-500 p-5 text-white"
    >
      {/* Sheen */}
      <div className="pointer-events-none absolute -right-6 -top-10 size-32 rounded-full bg-white/15 blur-2xl" />
      <div className="relative">
        <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">
          {featured.eyebrow}
        </p>
        <p className="mt-1 text-base font-semibold leading-tight">{featured.title}</p>
        <p className="mt-1.5 text-[13px] leading-snug text-white/80">
          {featured.description}
        </p>
      </div>
      <span className="relative mt-4 inline-flex items-center gap-1 text-sm font-medium">
        {featured.cta}
        <ArrowRight className="size-4 transition-transform duration-200 group-hover/feat:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

// ─── Theme toggle ────────────────────────────────────────────────────────────
// Sun/Moon swap driven purely by the `dark` class (next-themes attribute="class"),
// so it renders identically on server and client — no hydration flash, no mounted
// guard needed. The click handler reads the resolved theme to decide the flip.

function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle light and dark theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={cn(
        'relative inline-flex size-9 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <Sun className="size-[18px] rotate-0 scale-100 transition-transform duration-300 dark:-rotate-90 dark:scale-0" aria-hidden="true" />
      <Moon className="absolute size-[18px] rotate-90 scale-0 transition-transform duration-300 dark:rotate-0 dark:scale-100" aria-hidden="true" />
    </button>
  );
}

// ─── Full-page mobile menu ───────────────────────────────────────────────────

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <m.div
          id="mobile-menu"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tween.fast }}
          exit={{ opacity: 0, transition: tween.fast }}
          className="pointer-events-auto fixed inset-0 z-40 overflow-y-auto bg-background/95 backdrop-blur-xl md:hidden"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 5rem)' }}
        >
          {/* Violet bloom backdrop */}
          <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-violet-600/15 blur-3xl" />

          {/* Top bar: theme toggle + an unmistakable close button */}
          <div
            className="absolute right-4 z-10 flex items-center gap-1"
            style={{ top: 'calc(env(safe-area-inset-top) + 0.9rem)' }}
          >
            <ThemeToggleButton />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="inline-flex size-9 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          <m.div
            variants={staggerContainer(0.05, 0.04)}
            initial="hidden"
            animate="visible"
            className="relative mx-auto flex min-h-full w-full max-w-md flex-col gap-7 px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)]"
          >
            {MEGA_MENUS.map((mm) => (
              <m.section key={mm.key} variants={fadeRise} className="flex flex-col gap-1">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
                  {mm.label}
                </p>
                <ul className="flex list-none flex-col">
                  {mm.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className="flex items-center gap-3.5 rounded-2xl py-3 transition-colors active:bg-accent"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
                            <Icon className="size-5" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[15px] font-medium text-foreground">
                              {item.title}
                            </span>
                            <span className="block truncate text-[13px] text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </m.section>
            ))}

            {/* Direct links */}
            <m.div variants={fadeRise} className="flex flex-col">
              {DIRECT_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onClose}
                  className="flex items-center justify-between rounded-2xl py-3 text-[15px] font-medium text-foreground transition-colors active:bg-accent"
                >
                  {link.label}
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              ))}
            </m.div>

            {/* CTAs */}
            <m.div variants={fadeRise} className="mt-auto flex flex-col gap-2.5 pt-2">
              <Button
                variant="outline"
                className="h-11 w-full rounded-full text-[15px]"
                render={<Link href="/sign_in" onClick={onClose} />}
              >
                Sign in
              </Button>
              <Button
                className="h-11 w-full rounded-full text-[15px]"
                render={<Link href="/sign_in?mode=signup" onClick={onClose} />}
              >
                Get started
              </Button>
            </m.div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function useScroll(threshold: number) {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

function WordmarkLogo() {
  return (
    <>
      <Image src="/logo-symbol-dark.png" alt="" width={20} height={20} className="rounded dark:hidden" aria-hidden="true" />
      <Image src="/logo-symbol-light.png" alt="" width={20} height={20} className="hidden rounded dark:block" aria-hidden="true" />
      <span className="font-display text-base font-semibold tracking-tight text-foreground">Poggle</span>
    </>
  );
}
