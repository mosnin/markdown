"use client";

import { FitScale } from "./fit-scale";

/**
 * An agent researching for a document: a member's request, a search, and the
 * scraped results that feed a draft on a branch. Adapted from ForgeUI "Agent
 * Research"; the layout, the 3x3 pulse grid and the bottom fade are the
 * original's.
 */
function SearchGlyph({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </svg>
  );
}

function PulseDots() {
  return (
    <span className="grid shrink-0 grid-cols-3 gap-1">
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => (
          <span
            key={`${r}-${c}`}
            data-mk-motion=""
            className="ar-dot size-[3px] rounded-full bg-agent"
            style={{ animationDelay: `${(r + c) * 0.13}s` }}
          />
        )),
      )}
      <style>{`@keyframes ar-pulse{0%,100%{opacity:.2}50%{opacity:.95}}.ar-dot{animation:ar-pulse 1.5s ease-in-out infinite}`}</style>
    </span>
  );
}

/** The result glyph: a line turning a corner into the document. */
function FeedGlyph({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 5v6a3 3 0 0 0 3 3h11" />
      <path d="m15 10 5 4-5 4" />
    </svg>
  );
}

function Result({
  tool,
  source,
  note,
}: {
  tool: string;
  source: string;
  note: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <FeedGlyph className="mt-1 size-[16px] shrink-0 text-ink-4" />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="t-mk-ill-mono-12 text-ink-3">{tool}</span>
          <span className="t-mk-ill-13s ml-3 text-ink-2">{source}</span>
        </p>
        <p className="t-mk-ill-12 mt-2 truncate text-ink-3">{note}</p>
      </div>
    </div>
  );
}

export function AgentResearch({ className }: { className?: string }) {
  return (
    <div className={className}>
      <FitScale width={580} height={380}>
        <div className="relative h-full w-full">
          <div className="mx-auto w-[520px] pt-8">
            <div className="flex flex-col items-end">
              <div className="w-fit max-w-[360px] rounded-16 rounded-br-4 border border-border bg-raised px-6 py-5 shadow-elev-1">
                <p className="t-mk-ill-13 text-ink">
                  Refresh the competitor section of the market analysis.
                </p>
              </div>
            </div>

            <div className="mt-8 flex items-center gap-4">
              <PulseDots />
              <span className="t-mk-ill-mono-12 text-agent-text">
                research_search
              </span>
              <span className="t-mk-ill-12 text-ink-3">3 sources, 12s</span>
            </div>

            <p className="t-mk-ill-13 mt-5 text-ink-2">
              Reading the current pricing pages, then committing the update to a
              branch for review.
            </p>

            <div className="mt-6 flex flex-col items-start gap-4 rounded-t-12 border border-b-0 border-border bg-raised shadow-elev-1">
              <div className="flex w-full gap-4 border-b border-hairline px-6 py-5">
                <SearchGlyph className="size-[18px] shrink-0 text-ink-3" />
                <span className="t-mk-ill-13 truncate text-ink">
                  mid-market analytics pricing changes 2026
                </span>
              </div>

              <div className="mt-4 space-y-5 px-6">
                <Result
                  tool="research_scrape"
                  source="acme.com/pricing"
                  note="Three tiers, seat based, 20% off annual. Starter tier removed in July."
                />
                <Result
                  tool="research_scrape"
                  source="globex.io/plans"
                  note="Usage based since March. No free tier, 14 day trial on request."
                />
              </div>
            </div>
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[112px]"
            style={{
              background:
                "linear-gradient(to top, var(--surface-canvas), transparent)",
            }}
          />
        </div>
      </FitScale>
    </div>
  );
}
