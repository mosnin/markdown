import { cn } from '@/lib/utils';
import React from 'react';

type FeatureType = {
	title: string;
	icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
	description: string;
};

type FeatureCardPorps = React.ComponentProps<'div'> & {
	feature: FeatureType;
};

/**
 * Feature card with a quiet monochrome grid backdrop.
 *
 * The redesign drops the radial color wash; the background is now a
 * deterministic dotted pattern rendered at ~5% opacity in the foreground
 * color, masked into the upper area of the card. Type carries the page —
 * the icon, title, and description sit on a flat surface.
 */
export function FeatureCard({ feature, className, ...props }: FeatureCardPorps) {
	// Seed from the feature title so server and client produce the same
	// pattern during hydration (previously `Math.random()` at render time
	// caused a React hydration mismatch).
	const p = getSeededPattern(feature.title, 5);

	return (
		<div className={cn('relative overflow-hidden p-6', className)} {...props}>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(white,transparent)]"
			>
				<GridPattern
					width={20}
					height={20}
					x="-12"
					y="4"
					squares={p}
					className="fill-foreground/[0.05] stroke-foreground/[0.08] absolute inset-0 h-full w-full"
				/>
			</div>
			<feature.icon className="text-muted-foreground size-5" strokeWidth={1.5} aria-hidden />
			<h3 className="mt-8 text-base font-semibold tracking-tight text-foreground">{feature.title}</h3>
			<p className="text-muted-foreground relative z-20 mt-2 text-sm leading-relaxed">{feature.description}</p>
		</div>
	);
}

function GridPattern({
	width,
	height,
	x,
	y,
	squares,
	...props
}: React.ComponentProps<'svg'> & { width: number; height: number; x: string; y: string; squares?: number[][] }) {
	const patternId = React.useId();

	return (
		<svg aria-hidden="true" {...props}>
			<defs>
				<pattern id={patternId} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
					<path d={`M.5 ${height}V.5H${width}`} fill="none" />
				</pattern>
			</defs>
			<rect width="100%" height="100%" strokeWidth={0} fill={`url(#${patternId})`} />
			{squares && (
				<svg x={x} y={y} className="overflow-visible">
					{squares.map(([x, y], index) => (
						<rect strokeWidth="0" key={index} width={width + 1} height={height + 1} x={x * width} y={y * height} />
					))}
				</svg>
			)}
		</svg>
	);
}

/**
 * Deterministic pattern generator. Same `seed` + `length` always yields the
 * same output on server and client, so the value is safe to compute during
 * render without triggering hydration mismatches.
 */
function getSeededPattern(seed: string, length: number): number[][] {
	const rand = mulberry32(hashStringToSeed(seed));
	return Array.from({ length }, () => [
		Math.floor(rand() * 4) + 7, // x between 7 and 10
		Math.floor(rand() * 6) + 1, // y between 1 and 6
	]);
}

/** Tiny deterministic PRNG — good enough for cosmetic patterns. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** FNV-1a 32-bit hash — stable across JS engines. */
function hashStringToSeed(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}
