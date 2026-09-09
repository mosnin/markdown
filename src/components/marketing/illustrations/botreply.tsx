"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Adapted from the licensed ForgeUI "botreply" block. Same oversized chat
// window bleeding off the right and bottom edges, same rail and message
// rhythm. The chat brand colours are gone: the rail tile and the replying
// identity are an agent on the agent wash, and the reply carries one
// field-level proposal with a Commit affordance.

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function FitScale({
  width,
  height,
  className,
  children,
}: {
  width: number;
  height: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex w-full justify-center overflow-hidden",
        className,
      )}
      style={{
        height: (scale || 1) * height,
        visibility: scale ? "visible" : "hidden",
      }}
    >
      <div
        className="relative shrink-0"
        style={{ width: width * scale, height: height * scale }}
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

const mention = "rounded-4 bg-agent-wash px-1 text-agent-text";

export const BotReply = ({ className }: { className?: string }) => {
  return (
    <FitScale width={620} height={400} className={className}>
      <div className="relative h-full w-full">
        <div
          className="absolute overflow-hidden rounded-16 border border-border shadow-elev-2"
          style={{ left: 48, top: 20, width: 700, height: 440 }}
        >
          <div className="flex h-full">
            <div className="flex w-[68px] shrink-0 flex-col items-center gap-4 bg-rail pt-5">
              <div className="t-mk-ill-12s grid size-[44px] place-items-center rounded-12 bg-agent-wash text-agent-text">
                AI
              </div>
              <span className="my-1 h-[2px] w-[32px] rounded-full bg-hairline" />
              <span className="size-[44px] rounded-12 bg-inset" />
              <span className="size-[44px] rounded-12 bg-inset" />
            </div>

            <div className="min-w-0 flex-1 bg-raised pt-7 pr-8 pl-6">
              <div className="flex flex-col gap-7">
                <div className="flex gap-5">
                  <span className="t-mk-ill-13s grid size-[40px] shrink-0 place-items-center rounded-full bg-inset text-ink-2">
                    M
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-4">
                      <span className="t-mk-ill-15s text-ink">Marcus</span>
                      <span className="t-mk-ill-11 text-ink-3">9:16 AM</span>
                    </div>
                    <p className="t-mk-ill-13 mt-1 whitespace-nowrap text-ink">
                      <span className={mention}>@Review with AI</span> check the
                      ICP against the Q3 interview notes
                    </p>
                  </div>
                </div>

                <div className="flex gap-5">
                  <div className="t-mk-ill-12s grid size-[40px] shrink-0 place-items-center rounded-10 bg-agent-wash text-agent-text">
                    AI
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-4">
                      <span className="t-mk-ill-15s text-ink">
                        Review with AI
                      </span>
                      <span className="t-mk-ill-11 text-ink-3">9:16 AM</span>
                    </div>
                    <p className="t-mk-ill-13 mt-1 whitespace-nowrap text-ink">
                      One field is out of date against the notes. Proposed
                      change, base a3f9c1e:
                    </p>

                    <div className="mt-5 w-[420px] overflow-hidden rounded-8 border border-hairline bg-object">
                      <div className="flex items-center gap-4 border-b border-hairline px-5 py-3">
                        <span className="t-mk-ill-12s text-ink">Pains</span>
                        <span className="t-mk-ill-mono-11 text-ink-3">
                          icp · field 2 of 4
                        </span>
                      </div>
                      <div className="t-mk-ill-mono-12 px-5 py-4">
                        <div className="flex gap-4 text-ink-3">
                          <span className="w-[10px] shrink-0 text-right">
                            {" "}
                          </span>
                          <span>Context lives in twelve tools</span>
                        </div>
                        <div className="mt-1 flex gap-4 rounded-4 bg-diff-add text-diff-add-ink">
                          <span className="w-[10px] shrink-0 text-right">
                            +
                          </span>
                          <span>Manual CRM exports every Friday</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center gap-4">
                      <button
                        type="button"
                        className="t-mk-ill-12s rounded-6 bg-inverse px-5 py-3 text-ink-inverse"
                      >
                        Commit
                      </button>
                      <span className="t-mk-ill-mono-11 text-ink-3">
                        becomes #0143 on main
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[176px]"
          style={{
            background:
              "linear-gradient(to left, var(--surface-canvas), transparent)",
          }}
        />

        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[112px]"
          style={{
            background:
              "linear-gradient(to top, var(--surface-canvas), transparent)",
          }}
        />
      </div>
    </FitScale>
  );
};

export default BotReply;
