"use client";

import { cn } from "@/lib/utils";
import { FitScale } from "./fit-scale";

/**
 * A company with no documents yet. Adapted from ForgeUI "Empty Project"; the
 * three fanned cards and their rotations are the original's.
 */
export function EmptyProject({ className }: { className?: string }) {
  return (
    <div className={className}>
      <FitScale width={460} height={300}>
        <div className="relative h-full w-full overflow-hidden">
          <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-6">
            <div className="relative h-[160px] w-[384px]">
              <DocumentCard
                variant="back"
                className="absolute top-[4px] left-[36px] -rotate-10"
              />
              <DocumentCard
                variant="mid"
                className="absolute top-[8px] left-[108px] rotate-10"
              />
              <DocumentCard
                variant="front"
                className="absolute top-[32px] left-[72px] z-10 -rotate-2"
              />
            </div>

            <div className="flex flex-col items-center gap-2 text-center">
              <p className="t-mk-ill-15s text-ink">No documents yet</p>
              <p className="t-mk-ill-13 text-ink-3">
                Found the company to open the core pages
              </p>
            </div>
          </div>
        </div>
      </FitScale>
    </div>
  );
}

const SURFACE = {
  front: "border border-border bg-raised shadow-elev-2",
  mid: "border border-border bg-raised shadow-elev-1",
  back: "border border-border bg-inset",
};

type Variant = keyof typeof SURFACE;

function DocumentCard({
  variant,
  className = "",
}: {
  variant: Variant;
  className?: string;
}) {
  const front = variant === "front";
  return (
    <div
      className={cn(
        "h-[96px] w-[240px] rounded-16 p-5",
        SURFACE[variant],
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "size-[36px] shrink-0 rounded-8",
            front ? "bg-strong" : "bg-track",
          )}
        />
        <div className="flex flex-1 flex-col gap-3">
          <div
            className={cn(
              "h-[8px] rounded-full",
              front ? "w-[96px] bg-strong" : "w-[80px] bg-track",
            )}
          />
          <div
            className={cn(
              "h-[6px] rounded-full",
              front ? "w-[64px] bg-track" : "w-[48px] bg-track/70",
            )}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <div
          className={cn(
            "h-[6px] w-full rounded-full",
            front ? "bg-track" : "bg-track/60",
          )}
        />
        <div
          className={cn(
            "h-[6px] rounded-full",
            front ? "w-2/3 bg-track" : "w-1/2 bg-track/60",
          )}
        />
      </div>
    </div>
  );
}
