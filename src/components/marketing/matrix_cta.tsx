import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { MatrixRain } from "@/components/ui/matrix-rain";
import { MarketingSection } from "@/components/marketing/sections";
import { Button } from "@/components/ui/button";

// ─── Matrix-backed CTA ───────────────────────────────────────────────────────
//
// The final call-to-action with the blue matrix-rain falling behind it (scrimmed
// for legibility), replacing the old gradient card. Reusable across pages.

type CtaLink = { label: string; href: string };

export function MatrixCta({
  title,
  subtitle,
  primary,
  secondary,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  primary: CtaLink;
  secondary?: CtaLink;
}) {
  return (
    <MarketingSection>
      <div className="relative isolate overflow-hidden rounded-3xl border border-border/60 px-6 py-16 text-center sm:px-12 sm:py-24">
        {/* Matrix rain background */}
        <div className="absolute inset-0 -z-10">
          <MatrixRain fixedColor="#38bdf8" fontSize={16} speed={55} />
        </div>
        {/* Legibility scrim */}
        <div className="absolute inset-0 -z-10 bg-background/55" />

        <div className="relative mx-auto max-w-2xl">
          <h2 className="font-hero text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h2>
          {subtitle && (
            <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
              {subtitle}
            </p>
          )}
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="rounded-full" render={<Link href={primary.href} />}>
              {primary.label}
              <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
            </Button>
            {secondary && (
              <Button
                size="lg"
                variant="outline"
                className="rounded-full"
                render={<Link href={secondary.href} />}
              >
                {secondary.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </MarketingSection>
  );
}
