"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrustBar } from "@/components/marketing/trust_bar";

// ─── Full homepage hero ───────────────────────────────────────────────────────

/**
 * Quiet, centered marketing hero. No glitch, no animated blob background.
 * Single fade-in on mount, gracefully muted under prefers-reduced-motion.
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
					className="flex flex-col items-center gap-6 text-center"
				>
					{/* Eyebrow / NEW chip */}
					<Link
						href="/features"
						className="group inline-flex items-center gap-2"
					>
						<Badge variant="brand-subtle" className="h-6 px-2 text-[11px]">
							NEW
						</Badge>
						<span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
							Skills, agents, files &amp; multi-object workspaces
						</span>
						<ArrowRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
					</Link>

					{/* H1 */}
					<h1
						className={cn(
							"max-w-3xl text-balance",
							"text-5xl font-semibold tracking-tight text-foreground",
							"sm:text-6xl md:text-7xl",
							"leading-[1.05]",
						)}
					>
						Structured context.
						<br />
						Built for AI.
					</h1>

					{/* Description */}
					<p className="max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
						Poggle is a structured context store for AI workflows. Organize
						notes, files, skills, and agents into focused boxes — and deliver
						clean context via API or MCP.
					</p>

					{/* CTAs */}
					<div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
						<Button size="lg" render={<Link href="/sign_in" />}>
							Get started free
						</Button>
						<Button
							size="lg"
							variant="ghost"
							render={<Link href="/features" />}
						>
							Explore features
						</Button>
					</div>

					{/* Trust */}
					<div className="mt-4">
						<TrustBar />
					</div>

					<p className="text-xs text-muted-foreground/70">
						Free forever · No credit card · Import from Obsidian in minutes
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
