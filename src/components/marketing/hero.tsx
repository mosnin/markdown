"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ─── Full homepage hero ───────────────────────────────────────────────────────

/**
 * Quiet, centered marketing hero. One H1, one paragraph, two actions, one
 * screenshot. Single fade-in on mount, muted under prefers-reduced-motion.
 *
 * The brand-yellow primary CTA carries the only saturated color above the
 * fold — every other affordance is neutral so the eye lands on the action.
 */
export function HeroSection() {
	const reduceMotion = useReducedMotion();
	const initial = reduceMotion ? false : { opacity: 0, y: 8 };
	const animate = { opacity: 1, y: 0 };

	return (
		<section className="relative w-full overflow-hidden">
			<div className="relative z-10 mx-auto w-full max-w-5xl px-6 pt-24 pb-16 sm:pt-28">
				<motion.div
					initial={initial}
					animate={animate}
					transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
					className="flex flex-col items-center gap-7 text-center"
				>
					{/* H1 — the poster. Names the feeling, not the architecture. */}
					<h1
						className={cn(
							"max-w-3xl text-balance",
							"text-4xl font-semibold tracking-tight text-foreground",
							"sm:text-6xl md:text-7xl",
							"leading-[1.04]",
						)}
					>
						The context layer
						<br />
						for AI engineers.
					</h1>

					{/* Supporting paragraph — speaks to one customer: the engineer
					    shipping with Claude / GPT / Cursor / Copilot every day. */}
					<p className="max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
						Stop pasting the same architecture notes into every chat. Poggle
						is a markdown-native, branch-aware context store with first-class
						MCP, version history, and clean bundles your model actually reads.
					</p>

					{/* CTAs — full-width on small screens, side-by-side on sm+ */}
					<div className="mt-1 flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
						<Button
							size="lg"
							variant="brand"
							className="w-full sm:w-auto"
							render={<Link href="/sign_in" />}
						>
							Start free
						</Button>
						<Button
							size="lg"
							variant="ghost"
							className="w-full sm:w-auto"
							render={<Link href="/api" />}
						>
							Read the API docs →
						</Button>
					</div>

					<p className="text-xs text-muted-foreground/70">
						MCP-ready · Plain markdown · No credit card to start
					</p>
				</motion.div>

				{/* Product screenshot frame */}
				<motion.div
					initial={initial}
					animate={animate}
					transition={{ duration: 0.6, delay: 0.1, ease: [0.2, 0, 0, 1] }}
					className={cn(
						"relative mx-auto mt-16 max-w-5xl",
						"[mask-image:linear-gradient(to_bottom,black_75%,transparent)]",
					)}
				>
					<div className="overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-xl shadow-black/5 dark:shadow-black/30">
						<Image
							src="/dashboard-screenshot.png"
							alt="Poggle dashboard"
							width={1280}
							height={720}
							className="rounded-lg w-full"
							priority
						/>
					</div>
				</motion.div>
			</div>
		</section>
	);
}

// ─── Interior page hero ───────────────────────────────────────────────────────

/**
 * Centered interior-page hero. Eyebrow overline, large H1, supporting copy,
 * and optional CTA pair. Single fade-in on mount; honors reduced-motion.
 */
export function PageHeroSection({
	eyebrow,
	title,
	description,
	ctaPrimary,
	ctaSecondary,
}: {
	eyebrow: string;
	title: React.ReactNode;
	description?: string;
	ctaPrimary?: { label: string; href: string };
	ctaSecondary?: { label: string; href: string };
}) {
	const reduceMotion = useReducedMotion();
	const initial = reduceMotion ? false : { opacity: 0, y: 8 };
	const animate = { opacity: 1, y: 0 };

	return (
		<section className="border-b border-border bg-background">
			<motion.div
				initial={initial}
				animate={animate}
				transition={{ duration: 0.45, ease: [0.2, 0, 0, 1] }}
				className="relative mx-auto max-w-3xl px-6 pt-24 pb-16 text-center sm:pt-28 sm:pb-20"
			>
				<p className="mb-4 text-overline text-brand">{eyebrow}</p>
				<h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl md:text-6xl leading-[1.05]">
					{title}
				</h1>
				{description && (
					<p className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
						{description}
					</p>
				)}
				{(ctaPrimary ?? ctaSecondary) && (
					<div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
						{ctaPrimary && (
							<Button size="lg" render={<Link href={ctaPrimary.href} />}>
								{ctaPrimary.label}
							</Button>
						)}
						{ctaSecondary && (
							<Button
								size="lg"
								variant="ghost"
								render={<Link href={ctaSecondary.href} />}
							>
								{ctaSecondary.label}
							</Button>
						)}
					</div>
				)}
			</motion.div>
		</section>
	);
}
