import type { ReactNode } from "react";
import { CutButton } from "@/components/marketing/cut-button";
import { Kicker } from "@/components/marketing/corner-plus";
import { FitScale } from "@/components/marketing/illustrations/fit-scale";
import { RelayWindow } from "@/components/marketing/relay-window";

/* ==========================================================================
   The hero: centered copy above the product window, shown flat. The headline
   is solid ink, not a gradient (anti-slop rule 2), and there is no badge
   above it (rule 10): the kicker is a section label, set the way every other
   section opens.
   ========================================================================== */

export function Hero(): ReactNode {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div className="mk-container-wide relative flex flex-col gap-12 pt-12 lg:pt-12">
        <div className="mx-auto flex w-full max-w-[800px] flex-col items-center gap-8 text-center">
          <Kicker>Poggle</Kicker>
          <h1 id="hero-title" className="t-mk-hero text-balance text-ink">
            Shared memory for your coding agents.
          </h1>
          <p className="t-mk-lead max-w-[56ch] text-pretty text-ink-2">
            One agent hits a usage cap three hours in. The next one starts from
            zero — it does not know the goal, what already failed, or what is
            half-finished. Poggle logs what your agents do as they do it, so the
            next one picks up where the last one stopped.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CutButton href="/sign_in" size="lg">
              Start free
            </CutButton>
            <CutButton href="/how-it-works" variant="outline" size="lg">
              See how it works
            </CutButton>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[1040px] pb-6 lg:pb-12">
          {/* The product window, flat and at rest: the site shows the
              instrument the way the person will meet it. */}
          <FitScale width={1040} height={600}>
            <RelayWindow />
          </FitScale>
        </div>
      </div>
    </section>
  );
}
