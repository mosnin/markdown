"use client";

import { FitScale } from "./fit-scale";

/**
 * Review with AI reading a typed document field by field. Adapted from
 * ForgeUI "Page Scan"; the 3x3 frame grid, the scan band and its 2.6s sweep
 * are the original's. The wash behind the page is the agent hue, because the
 * reviewer is an agent.
 */
function Spinner() {
  return (
    <span className="relative ml-1 inline-block size-[16px] text-ink-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          data-mk-motion=""
          className="ps-spin absolute top-1/2 left-1/2 w-[4px] rounded-full bg-current"
          style={{
            height: 1.5,
            transform: `translate(-50%, -50%) rotate(${i * 36}deg) translate(146%)`,
            animationDelay: `${-900 + i * 100}ms`,
          }}
        />
      ))}
    </span>
  );
}

export function PageScan({ className }: { className?: string }) {
  return (
    <div className={className}>
      <FitScale width={460} height={330}>
        <div className="relative h-full w-full overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            <div className="absolute top-[16px] -left-[40px] size-[208px] rounded-full bg-agent-wash blur-3xl" />
            <div className="absolute -right-[40px] bottom-[24px] size-[208px] rounded-full bg-agent-wash blur-3xl" />
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2"
            style={{
              width: 620,
              height: 406,
              gridTemplateColumns: "150px 300px 150px",
              gridTemplateRows: "90px 206px 90px",
              gap: 10,
            }}
          >
            {Array.from({ length: 9 }).map((_, i) =>
              i === 4 ? (
                <div key={i} />
              ) : (
                <div
                  key={i}
                  className="rounded-16 border border-hairline bg-raised"
                />
              ),
            )}
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            <div
              className="absolute inset-x-0 top-0 h-[64px]"
              style={{
                background:
                  "linear-gradient(to bottom, var(--surface-canvas), transparent)",
              }}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-[64px]"
              style={{
                background:
                  "linear-gradient(to top, var(--surface-canvas), transparent)",
              }}
            />
            <div
              className="absolute inset-y-0 left-0 w-[64px]"
              style={{
                background:
                  "linear-gradient(to right, var(--surface-canvas), transparent)",
              }}
            />
            <div
              className="absolute inset-y-0 right-0 w-[64px]"
              style={{
                background:
                  "linear-gradient(to left, var(--surface-canvas), transparent)",
              }}
            />
          </div>

          <div
            className="absolute flex flex-col overflow-hidden rounded-12 border border-border bg-raised shadow-elev-2"
            style={{ top: 62, right: 80, bottom: 62, left: 80 }}
          >
            <div className="flex items-center gap-3 border-b border-hairline px-6 py-4">
              <span className="size-[8px] rounded-full bg-track" />
              <span className="size-[8px] rounded-full bg-track" />
              <span className="size-[8px] rounded-full bg-track" />
              <span className="t-mk-ill-mono-11 ml-2 text-ink-3">
                marketing/icp
              </span>
            </div>

            <div className="relative flex-1 overflow-hidden px-8 py-6">
              <div className="flex flex-col gap-4">
                <div className="h-[12px] w-[96px] rounded-2 bg-strong" />
                <div className="h-[8px] w-full rounded-2 bg-track" />
                <div className="h-[8px] w-11/12 rounded-2 bg-track" />
                <div className="h-[8px] w-3/4 rounded-2 bg-track" />
                <div className="mt-3 h-[12px] w-[80px] rounded-2 bg-strong" />
                <div className="h-[8px] w-full rounded-2 bg-track" />
                <div className="h-[8px] w-5/6 rounded-2 bg-track" />
                <div className="h-[8px] w-2/3 rounded-2 bg-track" />
              </div>

              <div
                data-mk-motion=""
                className="ps-scan pointer-events-none absolute inset-x-0 h-[32px]"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent, var(--agent-wash), transparent)",
                }}
              />
            </div>
          </div>

          <div className="absolute bottom-[44px] left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full border border-border bg-raised px-6 py-4 shadow-elev-1">
            <Spinner />
            <span className="t-mk-ill-12s text-ink-2">Reviewing with AI</span>
          </div>

          <style>{`
.ps-scan { top: 0; animation: ps-scanmove 2.6s ease-in-out infinite; }
@keyframes ps-scanmove {
  0% { top: -20%; opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
.ps-spin { animation: ps-spin 1s linear infinite; }
@keyframes ps-spin { 0% { opacity: 1; } 100% { opacity: 0.15; } }
          `}</style>
        </div>
      </FitScale>
    </div>
  );
}
