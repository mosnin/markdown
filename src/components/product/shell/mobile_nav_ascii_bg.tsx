"use client";

import { useEffect, useRef } from "react";

/**
 * Animated ASCII "context field" — the full-screen mobile nav backdrop.
 *
 * A monospace grid of glyphs driven by a cheap sum-of-sines flow field that
 * drifts slowly over time, producing an ambient "current of context" texture
 * that matches Poggle's mono / terminal brand. It is:
 *
 *   - violet-tinted and theme-aware (rebuilds its palette when `.dark` toggles),
 *   - throttled to ~14fps (battery-friendly; the field drifts slowly anyway),
 *   - devicePixelRatio-aware so glyphs stay crisp on retina screens,
 *   - fully static under `prefers-reduced-motion` (one painted frame, no loop),
 *   - painted to a <canvas> so thousands of glyphs cost almost nothing versus
 *     the equivalent DOM nodes.
 *
 * Everything is non-interactive (`pointer-events-none`, `aria-hidden`) — taps
 * fall through to the nav content layered above it.
 */

// Density ramp, sparse → dense. Index 0 (space) and 1 are never painted, which
// keeps the field airy so the routes layered on top stay legible.
const GLYPHS = " .·:-=+*o#%@";
const FPS = 14;
const FRAME_MS = 1000 / FPS;
const CELL = 16; // CSS px per glyph cell
const MONO =
  'ui-monospace, "Geist Mono", SFMono-Regular, Menlo, Consolas, monospace';

function AsciiFlowField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasEl = ref.current;
    if (!canvasEl) return;
    const ctx2d = canvasEl.getContext("2d");
    if (!ctx2d) return;
    // Explicitly-typed non-null aliases so the narrowing survives inside the
    // nested rAF / observer closures (TS doesn't always carry guard-narrowing
    // of a captured variable into a closure).
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const maxIdx = GLYPHS.length - 1;

    let cols = 0;
    let rows = 0;
    let cx = 0;
    let cy = 0;
    let palette: string[] = [];

    function buildPalette() {
      const dark = document.documentElement.classList.contains("dark");
      // violet-400 on dark, violet-700 on light
      const [r, g, b] = dark ? [167, 139, 250] : [109, 40, 217];
      const maxA = dark ? 0.5 : 0.32;
      palette = GLYPHS.split("").map((_, i) => {
        const t = i / maxIdx; // 0..1 density
        const a = maxA * (0.12 + 0.88 * t);
        if (dark && t > 0.82) {
          // brighten the densest glyphs toward violet-100 for a little sparkle
          const k = (t - 0.82) / 0.18;
          const rr = Math.round(r + (237 - r) * k);
          const gg = Math.round(g + (233 - g) * k);
          const bb = Math.round(b + (254 - b) * k);
          return `rgba(${rr},${gg},${bb},${a.toFixed(3)})`;
        }
        return `rgba(${r},${g},${b},${a.toFixed(3)})`;
      });
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${CELL}px ${MONO}`;
      ctx.textBaseline = "top";
      cols = Math.ceil(w / CELL) + 1;
      rows = Math.ceil(h / CELL) + 1;
      cx = cols / 2;
      cy = rows / 2;
      buildPalette();
    }

    function draw(time: number) {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      let last = -1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v =
            Math.sin(x * 0.16 + time) +
            Math.sin(y * 0.21 - time * 0.7) +
            Math.sin((x + y) * 0.1 + time * 0.45) +
            Math.sin(Math.hypot(x - cx, y - cy) * 0.13 - time * 1.05);
          let d = (v + 4) / 8; // normalize ~0..1
          d = d * d * (1.6 - 0.6 * d); // gentle contrast curve → airier field
          if (d <= 0) continue;
          if (d > 1) d = 1;
          const idx = (d * maxIdx) | 0;
          if (idx <= 1) continue;
          if (idx !== last) {
            ctx.fillStyle = palette[idx]!;
            last = idx;
          }
          ctx.fillText(GLYPHS[idx]!, x * CELL, y * CELL);
        }
      }
    }

    let raf = 0;
    let startTs = 0;
    let lastFrame = 0;

    function loop(ts: number) {
      raf = requestAnimationFrame(loop);
      if (!startTs) startTs = ts;
      if (ts - lastFrame < FRAME_MS) return;
      lastFrame = ts;
      draw((ts - startTs) / 1000);
    }

    function start() {
      cancelAnimationFrame(raf);
      if (media.matches) {
        draw(0.6); // single static frame
      } else {
        startTs = 0;
        lastFrame = 0;
        raf = requestAnimationFrame(loop);
      }
    }

    resize();
    start();

    const ro = new ResizeObserver(() => {
      resize();
      if (media.matches) draw(0.6);
    });
    ro.observe(canvas);

    // Rebuild the palette when the theme class flips so the field re-tints.
    const mo = new MutationObserver(() => {
      buildPalette();
      if (media.matches) draw(0.6);
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const onMedia = () => start();
    media.addEventListener("change", onMedia);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      media.removeEventListener("change", onMedia);
    };
  }, []);

  return (
    <canvas ref={ref} aria-hidden="true" className="absolute inset-0 h-full w-full" />
  );
}

/**
 * Full backdrop for the mobile nav sheet: the animated ASCII field, a violet
 * bloom echoing the sign-in brand panel, and a legibility scrim that keeps the
 * routes crisp over the texture. All non-interactive and theme-aware.
 */
export function MobileNavBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <AsciiFlowField />
      {/* Legibility scrim — dims the field so nav text stays readable. */}
      <div className="absolute inset-0 bg-gradient-to-b from-sidebar/72 via-sidebar/60 to-sidebar/82" />
      {/* Violet bloom, top-left — brand accent, sits above the scrim. */}
      <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
    </div>
  );
}
