import React from 'react';
import { cn } from '@/lib/utils';
import { GridPattern } from '@/components/ui/grid-pattern';

type GridCardProps = React.ComponentProps<'div'> & {
	/**
	 * Stable seed used to derive the decorative background pattern. The same
	 * seed always produces the same pattern on both server and client, which
	 * avoids a React hydration mismatch (previously we called `Math.random()`
	 * during render). Callers should pass the card's unique key (e.g. its
	 * title or id) so sibling cards still get visually distinct patterns.
	 */
	patternSeed?: string;
};

/**
 * Decorative grid-pattern card.
 *
 * The redesign drops the conic rainbow halo. The background is now a
 * single monochrome dotted/lined pattern rendered at low opacity through
 * a subtle radial mask, with the standard hairline border + bg-card
 * surface. The seed-driven pattern is preserved so SSR hydration stays
 * deterministic.
 */
export function GridCard({
	className,
	children,
	patternSeed,
	...props
}: GridCardProps) {
	return (
		<div
			className={cn(
				'group relative isolate z-0 flex h-full flex-col justify-between overflow-hidden rounded-lg border border-border bg-card px-5 py-4 transition-colors duration-150',
				className,
			)}
			{...props}
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(farthest-side_at_top_right,black,transparent_70%)]"
			>
				<GridPattern
					width={28}
					height={28}
					x={0}
					y={0}
					squares={getSeededPattern(patternSeed ?? '', 4)}
					className="fill-foreground/[0.04] stroke-foreground/[0.06] absolute inset-0 size-full"
				/>
			</div>
			<div className="relative">{children}</div>
		</div>
	);
}

/**
 * Deterministic pattern generator. Same `seed` + `length` always yields the
 * same output on server and client, so the value is safe to compute during
 * render without triggering hydration mismatches.
 */
function getSeededPattern(seed: string, length: number): [x: number, y: number][] {
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
