"use client";

import { FitScale } from "./fit-scale";

/**
 * The customer feedback inbox, read by Synthesize themes: feedback volume on
 * the line, the themes it resolved into in the corner. Adapted from ForgeUI
 * "Spam Inbox", which is a stacked window with an area chart; the frame
 * geometry, the path and the edge fades are the original's.
 */
const LINE =
  "M0,132 C5.3,131.3 31.5,126.5 42,126 C52.5,125.5 73.5,129.3 84,128 C94.5,126.8 115.5,118.5 126,116 C136.5,113.5 157.5,108.8 168,108 C178.5,107.3 199.5,112.3 210,110 C220.5,107.8 241.5,94 252,90 C262.5,86 283.5,79.1 294,78 C304.5,76.9 325.5,83 336,81 C346.5,79 367.5,65.6 378,62 C388.5,58.4 409.5,52.9 420,52 C430.5,51.1 451.5,56.8 462,55 C472.5,53.3 498.8,40.1 504,38";
const AREA = `${LINE} L504,260 L0,260 Z`;

export function FeedbackInbox({ className }: { className?: string }) {
  return (
    <div className={className}>
      <FitScale width={460} height={300}>
        <div className="relative h-full w-full overflow-hidden">
          <div className="absolute" style={{ left: 96, top: 58 }}>
            <div
              className="absolute rounded-20 border border-border bg-inset shadow-elev-1"
              style={{ left: -48, top: 30, width: 490, height: 300 }}
            />

            <div
              className="relative rounded-20 border border-border bg-inset p-4 shadow-elev-2"
              style={{ width: 520 }}
            >
              <div
                className="overflow-hidden rounded-16 border border-border bg-raised"
                style={{ height: 308 }}
              >
                <div className="flex h-[48px] items-center gap-4 border-b border-hairline px-7">
                  <div className="flex gap-4">
                    <span className="size-[10px] rounded-full bg-track" />
                    <span className="size-[10px] rounded-full bg-track" />
                    <span className="size-[10px] rounded-full bg-track" />
                  </div>
                  <span className="t-mk-ill-12 ml-2 text-ink-3">Feedback</span>
                </div>

                <div className="relative" style={{ height: 260 }}>
                  <svg
                    viewBox="0 0 504 260"
                    fill="none"
                    preserveAspectRatio="none"
                    className="h-full w-full"
                  >
                    <defs>
                      <linearGradient id="fb-area" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--series-1)"
                          stopOpacity="0.16"
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--series-1)"
                          stopOpacity="0"
                        />
                      </linearGradient>
                    </defs>

                    <path d={AREA} fill="url(#fb-area)" />
                    <path
                      d={LINE}
                      stroke="var(--series-1)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>

                  <div className="absolute top-4 left-5 flex items-baseline gap-4">
                    <p className="t-metric-md text-ink">1,284</p>
                    <span className="t-mk-ill-12 text-ink-3">items</span>
                    <span className="t-mk-ill-12s text-agent-text">
                      12 themes
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[112px]"
            style={{
              background:
                "linear-gradient(to left, var(--surface-canvas), transparent)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[96px]"
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
