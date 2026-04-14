"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useAnimationControls } from "motion/react";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AnimatedBackground } from "@/components/ui/animated-blur-blob-background";
import { MorphingText } from "@/components/ui/morphing-text";

// ─── Glitch title ─────────────────────────────────────────────────────────────

/**
 * Animated H1 that enters with a slide-up fade, then runs a subtle glitch
 * (horizontal shift + skew) on a random 3-6 second interval using motion.
 */
function GlitchTitle({
	children,
	className,
	delay = 0.1,
}: {
	children: React.ReactNode;
	className?: string;
	delay?: number;
}) {
	const controls = useAnimationControls();

	useEffect(() => {
		// Entrance animation
		void controls.start({
			opacity: 1,
			y: 0,
			transition: { duration: 0.5, delay, ease: "easeOut" },
		});

		// Periodic glitch loop
		let alive = true;
		const loop = async () => {
			while (alive) {
				// Random wait between glitches
				await new Promise<void>((r) =>
					setTimeout(r, 3000 + Math.random() * 3500),
				);
				if (!alive) break;
				await controls.start({
					x: -4,
					skewX: -3,
					filter: "blur(0.4px) brightness(1.15)",
					transition: { duration: 0.04, ease: "linear" },
				});
				await controls.start({
					x: 4,
					skewX: 2,
					filter: "none",
					transition: { duration: 0.04, ease: "linear" },
				});
				await controls.start({
					x: -2,
					skewX: 0,
					transition: { duration: 0.04, ease: "linear" },
				});
				await controls.start({
					x: 0,
					transition: { duration: 0.06, ease: "easeOut" },
				});
			}
		};
		void loop();
		return () => {
			alive = false;
		};
	}, [controls, delay]);

	return (
		<motion.h1
			initial={{ opacity: 0, y: 40 }}
			animate={controls}
			className={className}
		>
			{children}
		</motion.h1>
	);
}

// ─── Full homepage hero ───────────────────────────────────────────────────────

/**
 * Full hero for the homepage. Matches the structure of the hero-3 template:
 * badge → glitch title → description → CTA buttons → app screenshot frame.
 * The screenshot area is intentionally left blank — drop in a src when ready.
 */
export function HeroSection() {
	return (
		<section className="relative w-full overflow-hidden pt-16">
			{/* Animated blur blob background — full-viewport width behind the hero
			    content. Sits at z-0; content below is z-10. */}
			<AnimatedBackground />
			{/* Content — keeps its original max-w-5xl centered column */}
			<div className="relative z-10 mx-auto w-full max-w-5xl">
				<div className="flex max-w-2xl flex-col gap-5 px-4">
				{/* Badge */}
				<motion.a
					initial={{ opacity: 0, y: 40 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.5, duration: 0.5, ease: "easeOut" }}
					className={cn(
						"group flex w-fit items-center gap-3 rounded-sm border bg-card p-1 shadow-xs",
						"transition-all",
					)}
					href="/features"
				>
					<div className="rounded-xs border bg-card px-1.5 py-0.5 shadow-sm">
						<p className="font-mono text-xs">NEW</p>
					</div>
					<span className="text-xs">
						Skills, agents, files &amp; multi-object workspaces
					</span>
					<span className="block h-5 border-l" />
					<div className="pr-1">
						<ArrowRightIcon className="size-3 -translate-x-0.5 duration-150 ease-out group-hover:translate-x-0.5" />
					</div>
				</motion.a>

				{/* Glitch title */}
				<GlitchTitle
					delay={0.1}
					className={cn(
						"text-balance font-bold text-4xl text-foreground leading-tight md:text-5xl",
					)}
				>
					Structured context.
					<br />
					<MorphingText
						texts={[
							"Built for AI.",
							"Connected by semantics.",
							"Ready for MCP workflows.",
							"Versioned and auditable.",
						]}
					/>
				</GlitchTitle>

				{/* Description */}
				<motion.p
					initial={{ opacity: 0, y: 40 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
					className="text-muted-foreground text-sm tracking-wide sm:text-lg md:text-xl"
				>
					Poggle is a structured context store for AI workflows.
					Organize notes, files, skills, and agents into focused boxes.
					Build real package structures, connect everything with
					semantic links, and deliver clean context via API or MCP.
				</motion.p>

				{/* CTA */}
				<motion.div
					initial={{ opacity: 0, y: 40 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
					className="flex w-fit items-center justify-center gap-3 pt-2"
				>
					<Button variant="outline" render={<Link href="/features" />}>
						<SparklesIcon className="size-4 mr-2" data-icon="inline-start" />
						Explore features
					</Button>
					<Button render={<Link href="/sign_in" />}>
						Get started free
						<ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
					</Button>
				</motion.div>

				<motion.p
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ delay: 0.6, duration: 0.5 }}
					className="text-xs text-muted-foreground/50"
				>
					Free forever · No credit card · Import from Obsidian in minutes
				</motion.p>
			</div>

			{/* App screenshot frame — image placeholder */}
			<div className="relative">
				<div
					className={cn(
						"absolute -inset-x-20 inset-y-0 -translate-y-1/3 scale-125 rounded-full",
						"bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--color-violet-600)_10%,transparent),transparent,transparent)]",
						"blur-[50px]",
					)}
				/>
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1, duration: 1, ease: "easeOut" }}
					className={cn(
						"[mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
						"relative mt-8 -mr-56 overflow-hidden px-2 sm:mt-12 sm:mr-0 md:mt-20",
					)}
				>
					<div className="relative mx-auto max-w-5xl overflow-hidden rounded-lg border bg-background p-2 shadow-xl ring-1 ring-border/40">
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
		</div>
		</section>
	);
}

// ─── Interior page hero ───────────────────────────────────────────────────────

/**
 * Simpler centered hero for interior pages (features, pricing, about).
 * Same entrance animations and glitch title as HeroSection, without the
 * badge or screenshot frame.
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
	return (
		<section className="border-b border-border/50 bg-muted/20 py-20 pt-32">
			{/* Background shade */}
			<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden">
				<div
					className={cn(
						"absolute inset-0 isolate -z-10",
						"bg-[radial-gradient(40%_60%_at_50%_0%,color-mix(in_oklch,var(--color-violet-600)_10%,transparent),transparent)]",
					)}
				/>
			</div>

			<div className="relative mx-auto max-w-3xl px-6 text-center">
				{/* Eyebrow */}
				<motion.p
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4, delay: 0.4 }}
					className="mb-3 text-xs font-semibold uppercase tracking-widest text-violet-400"
				>
					{eyebrow}
				</motion.p>

				{/* Glitch title */}
				<GlitchTitle
					delay={0.1}
					className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl"
				>
					{title}
				</GlitchTitle>

				{/* Description */}
				{description && (
					<motion.p
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, delay: 0.2 }}
						className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground"
					>
						{description}
					</motion.p>
				)}

				{/* CTAs */}
				{(ctaPrimary ?? ctaSecondary) && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, delay: 0.3 }}
						className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
					>
						{ctaPrimary && (
							<Button render={<Link href={ctaPrimary.href} />}>
								{ctaPrimary.label}
								<ArrowRightIcon className="size-4 ml-2" data-icon="inline-end" />
							</Button>
						)}
						{ctaSecondary && (
							<Button variant="ghost" render={<Link href={ctaSecondary.href} />}>
								{ctaSecondary.label} →
							</Button>
						)}
					</motion.div>
				)}
			</div>
		</section>
	);
}
