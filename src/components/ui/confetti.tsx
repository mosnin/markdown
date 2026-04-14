"use client";

import { useEffect, useRef } from "react";

export function Confetti({
  active,
  durationMs = 1200,
}: {
  active: boolean;
  durationMs?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colors = ["#facc15", "#fde047", "#f59e0b", "#f97316", "#fef08a"];
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const particles = Array.from({ length: 140 }, () => ({
      x: width / 2,
      y: height * 0.35,
      vx: (Math.random() - 0.5) * 10,
      vy: -Math.random() * 10 - 2,
      size: Math.random() * 6 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      gravity: 0.18 + Math.random() * 0.06,
      life: 0,
    }));

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.life += 1;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - elapsed / durationMs);
        ctx.fillRect(p.x, p.y, p.size, p.size * 0.6);
      }
      ctx.globalAlpha = 1;

      if (elapsed < durationMs) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-40"
      aria-hidden="true"
    />
  );
}

export default Confetti;
