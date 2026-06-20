"use client";

import * as React from "react";

import { useMousePosition } from "@/hooks/use-mouse-position";
import { cn } from "@/lib/utils";

// ─── Tilt card ───────────────────────────────────────────────────────────────
//
// An interactive card that skews toward the cursor in 3D (perspective tilt),
// generalized from the animata github-card-skew so it takes children and uses
// the app's theme tokens. Replaces the flat bento cards on feature grids.

function cardRotation({
  currentX,
  currentY,
  centerX,
  centerY,
  maxRotationX,
  maxRotationY,
}: {
  currentX: number;
  currentY: number;
  centerX: number;
  centerY: number;
  maxRotationX: number;
  maxRotationY: number;
}) {
  const deltaX = currentX - centerX;
  const deltaY = currentY - centerY;
  const maxDistance = Math.sqrt(centerX ** 2 + centerY ** 2) || 1;
  const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);
  const factor = distance / maxDistance;
  const rotationY = ((-deltaX / (centerX || 1)) * maxRotationY * factor).toFixed(2);
  const rotationX = ((deltaY / (centerY || 1)) * maxRotationX * factor).toFixed(2);
  return { rotationX, rotationY };
}

export function TiltCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const settleRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const update = React.useCallback(({ x, y }: { x: number; y: number }) => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { rotationX, rotationY } = cardRotation({
      centerX: width / 2,
      centerY: height / 2,
      currentX: x,
      currentY: y,
      maxRotationX: 5,
      maxRotationY: 7,
    });
    el.style.setProperty("--rx", `${rotationX}deg`);
    el.style.setProperty("--ry", `${rotationY}deg`);
  }, []);

  useMousePosition(ref, update);

  return (
    <div
      ref={ref}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-3xl border border-border/60 bg-card/60 p-6 shadow-lg shadow-black/5 backdrop-blur-sm transition-transform ease-linear will-change-transform hover:border-border sm:p-8",
        className,
      )}
      style={{
        transform:
          "perspective(800px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
        transitionDuration: "60ms",
      }}
      onMouseEnter={() => {
        settleRef.current = setTimeout(() => {
          if (ref.current) ref.current.style.transitionDuration = "0ms";
        }, 200);
      }}
      onMouseLeave={() => {
        clearTimeout(settleRef.current);
        const el = ref.current;
        if (!el) return;
        el.style.transitionDuration = "300ms";
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      }}
    >
      {/* violet sheen toward the cursor */}
      <div className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-violet-500/[0.08] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative">{children}</div>
    </div>
  );
}
