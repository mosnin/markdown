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

export function GridCard({
	className,
	children,
	patternSeed,
	...props
}: GridCardProps) {
	return (
		<div
			className={cn(
				'group bg-background relative isolate z-0 flex h-full flex-col justify-between overflow-hidden rounded-sm border px-5 py-4 transition-colors duration-75',
				className,
			)}
			{...props}
		>
			<div className="absolute inset-0">
				<div className="absolute -inset-[25%] -skew-y-12 [mask-image:linear-gradient(225deg,black,transparent)]">
					<GridPattern
						width={30}
						height={30}
						x={0}
						y={0}
						squares={getSeededPattern(patternSeed ?? '', 5)}
						className="fill-border/50 stroke-border absolute inset-0 size-full translate-y-2 transition-transform duration-150 ease-out group-hover:translate-y-0"
					/>
				</div>
				<div
					className={cn(
						'absolute -inset-[10%] opacity-0 blur-[50px] transition-opacity duration-150 group-hover:opacity-10',
						'bg-[conic-gradient(#F35066_0deg,#F35066_117deg,#9071F9_180deg,#5182FC_240deg,#F35066_360deg)]',
					)}
				/>
			</div>
			{children}
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
