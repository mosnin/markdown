"use client";

import { useEffect, useRef } from "react";

/**
 * Poggle's signature ambient texture: a field of ASCII characters that flow
 * like something being assembled. Rendered to canvas for performance; honours
 * prefers-reduced-motion (draws a single static frame) and pauses while the
 * canvas is offscreen or the tab is hidden.
 *
 * Ported from the reference shell's AsciiField and recoloured from the legacy
 * baby-blue brand tone to Poggle violet: base rgba(139,92,246,a) with peaks
 * rgba(167,139,250,a). The optional `gradient` mode still flows through a
 * blue→violet ramp for marketing surfaces, but the shell uses the solid
 * violet path.
 *
 * Self-contained — no external deps beyond React.
 */
const GRADIENT_STOPS: [number, number, number][] = [
  [124, 119, 240], // indigo  #7C77F0
  [139, 92, 246], // violet   #8B5CF6  (Poggle primary)
  [167, 139, 250], // light violet #A78BFA
  [196, 181, 253], // pale violet  #C4B5FD
];

function lerpStop(t: number): [number, number, number] {
  const clamped = ((t % 1) + 1) % 1;
  const seg = clamped * (GRADIENT_STOPS.length - 1);
  const i = Math.min(GRADIENT_STOPS.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = GRADIENT_STOPS[i];
  const b = GRADIENT_STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function AsciiField({
  className,
  speed = 0.05,
  cell = 12,
  gradient = false,
}: {
  className?: string;
  speed?: number;
  cell?: number;
  gradient?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ramp = " .·:-=+*≡#%@";
    const cw = cell * 0.62; // monospace cell width
    let cols = 0;
    let rows = 0;
    let dpr = 1;
    let t = Math.random() * 100;
    let raf = 0;
    let last = 0;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const field = (x: number, y: number, tt: number) => {
      const cx = cols / 2;
      const cy = rows / 2;
      const v =
        Math.sin(x * 0.18 + tt) +
        Math.sin(y * 0.22 + tt * 0.7) +
        Math.sin((x + y) * 0.09 + tt * 1.1) +
        Math.sin(Math.hypot(x - cx, y - cy) * 0.13 - tt * 1.25);
      return (v + 4) / 8; // ~0..1
    };

    const draw = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = field(x, y, t);
          const idx = Math.max(
            0,
            Math.min(ramp.length - 1, Math.floor(v * (ramp.length - 1)))
          );
          const ch = ramp[idx];
          if (ch === " ") continue;
          const a = 0.06 + v * 0.5;
          if (gradient) {
            // Flowing indigo→violet gradient: hue follows x position + time, so
            // the colour drifts across the field as it animates.
            const [r, g, b] = lerpStop(
              x / Math.max(1, cols) + (y / Math.max(1, rows)) * 0.25 + t * 0.03
            );
            ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
          } else {
            // Solid Poggle violet — peaks tip toward the lighter violet.
            ctx.fillStyle =
              v > 0.86
                ? `rgba(167,139,250,${a.toFixed(3)})`
                : `rgba(139,92,246,${a.toFixed(3)})`;
          }
          ctx.fillText(ch, x * cw, y * cell);
        }
      }
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${cell}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textBaseline = "top";
      cols = Math.ceil(r.width / cw) + 1;
      rows = Math.ceil(r.height / cell) + 1;
      draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // Only animate while the canvas is actually on screen, and pause when the
    // tab is hidden. The shell mounts this behind the floating sidebar, so it
    // should idle (keeping its last static frame) whenever it isn't visible.
    const startLoop = () => {
      if (raf || reduce) return;
      const loop = (ts: number) => {
        raf = requestAnimationFrame(loop);
        if (ts - last < 33) return; // ~30 fps — alive but easy
        last = ts;
        t += speed;
        draw();
      };
      raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    let onScreen = false;
    const update = () => {
      if (onScreen && !document.hidden) startLoop();
      else stopLoop();
    };

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? false;
        update();
      },
      { rootMargin: "120px" }
    );
    io.observe(canvas);

    const onVisibility = () => update();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopLoop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [speed, cell, gradient]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
