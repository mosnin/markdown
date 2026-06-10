"use client";

import { useEffect, useState } from "react";

/**
 * Decrypt-on-mount text — the mobile nav's signature reveal.
 *
 * Renders the final string on the server (SSR-stable + accessible), then, once
 * on the client and only when the user has not requested reduced motion,
 * scrambles it and resolves it left-to-right like a value being decrypted. It
 * reinforces the "trust gate" brand without any accessibility cost: the real
 * text is always present for screen readers via a visually-hidden span, while
 * the animated scramble is `aria-hidden`.
 *
 * The text is rendered in a monospace face (Share Tech Mono via `font-display`,
 * or `font-mono`) so the scramble — which preserves length and spaces — never
 * shifts layout.
 */

const SCRAMBLE = "01<>/{}[]#$%*+=-_·:;";

function scrambleChar() {
  return SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]!;
}

export function GlyphReveal({
  text,
  className,
  delayMs = 0,
  durationMs = 460,
}: {
  text: string;
  className?: string;
  delayMs?: number;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Reduced motion: leave the text as-is. `display` already initializes to
    // `text` (and these labels are static), so there's nothing to animate.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const chars = text.split("");
    const total = chars.length;
    let raf = 0;
    let startAt = 0;
    let lastPaint = 0;

    function render(locked: number) {
      let out = "";
      for (let i = 0; i < total; i++) {
        const c = chars[i]!;
        out += c === " " ? " " : i < locked ? c : scrambleChar();
      }
      setDisplay(out);
    }

    function tick(ts: number) {
      if (!startAt) startAt = ts + delayMs;
      const elapsed = ts - startAt;
      // Throttle React state churn to ~30fps regardless of refresh rate.
      if (ts - lastPaint >= 33) {
        lastPaint = ts;
        if (elapsed <= 0) {
          render(0); // still in the stagger delay — hold a scrambled shimmer
        } else {
          const p = Math.min(1, elapsed / durationMs);
          render(Math.floor(p * total));
          if (p >= 1) {
            setDisplay(text);
            return; // resolved — stop the loop
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    render(0); // start scrambled so there's no flash of the final text
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, delayMs, durationMs]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{display}</span>
    </span>
  );
}
