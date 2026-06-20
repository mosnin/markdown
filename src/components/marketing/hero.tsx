import React from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetalButton } from "@/components/ui/metal-button";
import { TrustBar } from "@/components/marketing/trust_bar";
import { HeroDemo } from "@/components/marketing/hero_demo";
import { HeroBackdrop } from "@/components/marketing/hero_backdrop";
import { HeroRotator } from "@/components/marketing/hero_rotator";
import { NeumorphEyebrow } from "@/components/ui/neumorph-eyebrow";

// ─── Homepage hero ──────────────────────────────────────────────────────────
//
// One story: Poggle is the governed context layer for AI agents. Agents connect
// over MCP, read your workspace context, and PROPOSE changes you approve.
//
// The atmosphere is a live dithering-shader swirl pooled behind the demo; the
// headline ends on one rolling word; the demo stays the interactive centrepiece.
// The core message is server-rendered and instantly legible — motion decorates,
// it never gates the content.

export function HeroSection() {
  return (
    <section className="relative isolate w-full overflow-hidden border-b border-border/30">
      <HeroBackdrop />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28 lg:pt-28">
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
            <span className="block">The governed context layer for</span>
            <HeroRotator
              words={["AI agents.", "Claude.", "Cursor.", "your whole team."]}
            />
            <span className="sr-only">AI agents.</span>
          </h1>

          <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Poggle gives your AI agents a workspace they can read — and a trust
            gate they can&apos;t cross. Agents connect over MCP, read your
            context, and submit changes as proposals. Nothing is written until a
            human approves it.
          </p>

          <div className="flex flex-col items-stretch gap-3 pt-1 sm:flex-row sm:items-center">
            <MetalButton
              size="lg"
              preset="silver"
              borderRadius={9999}
              className="rounded-full"
              metalFxClassName="w-full rounded-full sm:w-fit"
              render={<Link href="/sign_in?mode=signup" />}
            >
              Get started free
              <ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
            </MetalButton>
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
    <section className="relative isolate overflow-hidden border-b border-border/50 bg-muted/20 py-20 pt-32">
      <HeroBackdrop
        shape="swirl"
        colorFg="#8b5cf6"
        intensity={0.5}
        scrimClassName="bg-background/45"
        centerScrim
      />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <NeumorphEyebrow className="mx-auto mb-3 uppercase tracking-[0.12em]">
          {eyebrow}
        </NeumorphEyebrow>

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
              <MetalButton preset="silver" render={<Link href={ctaPrimary.href} />}>
                {ctaPrimary.label}
                <ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
              </MetalButton>
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
