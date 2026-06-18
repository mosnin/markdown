import React from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrustBar } from "@/components/marketing/trust_bar";
import { HeroDemo } from "@/components/marketing/hero_demo";

// ─── Homepage hero ──────────────────────────────────────────────────────────
//
// One story: Poggle is the governed context layer for AI agents. Agents connect
// over MCP, read your workspace context, and PROPOSE changes you approve.
// No gimmicks — no glitch text, fake terminal frames, or animated blobs.

export function HeroSection() {
  return (
    <section className="relative w-full overflow-hidden border-b border-border/30">
      {/* Soft violet wash — restrained, focus stays on the demo */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[32rem] w-[42rem] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[100px]" />
        <div className="absolute right-[-10%] top-1/3 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-20 pt-16 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28 lg:pt-24">
        {/* Left — the story */}
        <div className="flex max-w-2xl flex-col gap-6">
          <Link
            href="/how-it-works"
            className="group flex w-fit items-center gap-3 rounded-full border border-border bg-card/70 px-3.5 py-1.5 text-xs text-muted-foreground shadow-xs backdrop-blur-sm transition-colors hover:bg-muted"
          >
            <span className="text-overline text-violet-400">MCP</span>
            <span className="h-4 border-l border-border" />
            <span>Agents propose. You approve.</span>
            <ArrowRightIcon className="size-3 -translate-x-0.5 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
          </Link>

          <h1 className="font-hero text-balance text-4xl font-bold leading-[1.05] tracking-tight text-foreground md:text-5xl lg:text-6xl">
            The governed context layer for AI agents.
          </h1>

          <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Poggle gives your AI agents a workspace they can read — and a trust
            gate they can&apos;t cross. Agents connect over MCP, read your
            context, and submit changes as proposals. Nothing is written until a
            human approves it.
          </p>

          <div className="flex flex-col items-stretch gap-3 pt-1 sm:flex-row sm:items-center">
            <Button size="lg" className="rounded-full" render={<Link href="/sign_in?mode=signup" />}>
              Get started free
              <ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
            </Button>
            <Button size="lg" variant="outline" className="rounded-full" render={<Link href="/how-it-works" />}>
              See how it works
            </Button>
          </div>

          <div className="pt-4">
            <TrustBar />
          </div>

          <p className="text-xs text-muted-foreground/60">
            Free to start · No credit card required
          </p>
        </div>

        {/* Right — the interactive trust-gate demo */}
        <div className="flex justify-center lg:justify-end">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}

// ─── Interior page hero ─────────────────────────────────────────────────────
//
// Simple centered hero for interior pages (pricing, how-it-works). Same brand
// voice as the homepage hero, without the badge or CTAs unless provided.

export function PageHeroSection({
  eyebrow,
  title,
  description,
  ctaPrimary,
  ctaSecondary,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: string;
  ctaPrimary?: { label: string; href: string };
  ctaSecondary?: { label: string; href: string };
}) {
  return (
    <section className="relative overflow-hidden border-b border-border/50 bg-muted/20 py-20 pt-32">
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <p className="text-overline mb-3 text-violet-400">{eyebrow}</p>

        <h1 className="font-hero text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {title}
        </h1>

        {description && (
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            {description}
          </p>
        )}

        {(ctaPrimary ?? ctaSecondary) && (
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {ctaPrimary && (
              <Button render={<Link href={ctaPrimary.href} />}>
                {ctaPrimary.label}
                <ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
              </Button>
            )}
            {ctaSecondary && (
              <Button variant="ghost" render={<Link href={ctaSecondary.href} />}>
                {ctaSecondary.label} →
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
