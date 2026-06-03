import React from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrustBar } from "@/components/marketing/trust_bar";

// ─── Homepage hero ──────────────────────────────────────────────────────────
//
// One story: Poggle is the governed context layer for AI agents. Agents connect
// over MCP, read your workspace context, and PROPOSE changes you approve.
// No gimmicks — no glitch text, fake terminal frames, or animated blobs.

export function HeroSection() {
  return (
    <section className="relative w-full overflow-hidden border-b border-border/30">
      <div className="mx-auto w-full max-w-5xl px-6 pt-24 pb-20 sm:pt-32">
        <div className="flex max-w-2xl flex-col gap-6">
          <Link
            href="/how-it-works"
            className="group flex w-fit items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-xs transition-colors hover:bg-muted"
          >
            <span className="text-overline text-violet-400">MCP</span>
            <span className="h-4 border-l border-border" />
            <span>Agents propose. You approve.</span>
            <ArrowRightIcon className="size-3 -translate-x-0.5 transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
          </Link>

          <h1 className="font-hero text-balance text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
            The governed context layer for AI agents.
          </h1>

          <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Poggle gives your AI agents a workspace they can read — and a trust
            gate they can&apos;t cross. Agents connect over MCP, read your
            context, and submit changes as proposals. Nothing is written until a
            human approves it.
          </p>

          <div className="flex flex-col items-stretch gap-3 pt-1 sm:flex-row sm:items-center">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get started free
              <ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/how-it-works" />}>
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
