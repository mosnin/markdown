"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import * as m from "motion/react-m";
import { staggerContainer, fadeRiseHero, fadeRise } from "@/lib/motion";

const FEATURES = [
  "Unlimited structured boxes",
  "AI-ready context bundles",
  "Full version history",
  "Plain markdown — always portable",
];

export function BrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between bg-[oklch(0.10_0.005_265)] p-10 lg:flex lg:w-1/2">
      {/* Iris glow blob — restrained */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-violet-600 opacity-[0.35] blur-3xl" />
      </div>

      {/* Animated content */}
      <m.div
        initial="hidden"
        animate="visible"
        variants={staggerContainer(0.08, 0.1)}
        className="relative flex flex-col gap-6"
      >
        {/* Logo */}
        <m.div variants={fadeRiseHero}>
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
              <div className="h-3 w-3 rounded-sm bg-white" />
            </div>
            <span className="text-sm font-semibold text-white">Poggle</span>
          </Link>
        </m.div>

        {/* Headline */}
        <m.div variants={fadeRise}>
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Your AI knows your notes.
          </h2>
          <p className="mt-2 text-sm text-white/60">
            Organize knowledge. Package perfect context. Never lose a decision.
          </p>
        </m.div>

        {/* Feature list */}
        <m.ul
          variants={staggerContainer(0.05, 0.2)}
          initial="hidden"
          animate="visible"
          className="space-y-3"
        >
          {FEATURES.map((f) => (
            <m.li
              key={f}
              variants={fadeRise}
              className="flex items-center gap-3 text-sm text-white/70"
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Check className="h-3 w-3 text-white/70" />
              </div>
              {f}
            </m.li>
          ))}
        </m.ul>
      </m.div>

      {/* Bottom quote */}
      <blockquote className="relative space-y-2">
        <p className="text-sm italic leading-relaxed text-white/60">
          &ldquo;Poggle changed how I work with AI. Every conversation
          starts with the right knowledge, not a blank slate.&rdquo;
        </p>
        <footer className="text-xs text-white/40">— Early beta user</footer>
      </blockquote>
    </div>
  );
}
