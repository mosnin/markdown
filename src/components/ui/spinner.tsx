import React from 'react';
import { cn } from '@/lib/utils';

interface SpinnerProps extends React.ComponentProps<'div'> {
	size?: number; // e.g. 16, 24, 32
	invert?: boolean;
	disabled?: boolean;
}

/**
 * Enterprise spinner.
 *
 * A quiet rotating arc — neutral foreground border at 20% opacity with a
 * single quarter-turn picked out in the foreground color. The `invert`
 * variant is preserved for placement on dark or branded surfaces, and the
 * `disabled` early-return is preserved so existing call sites stay
 * unchanged. Honors `prefers-reduced-motion` by halting the spin.
 */
export function Spinner({ size = 16, invert, disabled, className, style, ...props }: SpinnerProps) {
	if (disabled) return null;

	const sizePx = `${size}px`;
	// Border thickness scales gently with size, capped at 2px for legibility.
	const border = Math.max(1, Math.min(2, Math.round(size / 12)));

	const baseColor = invert ? 'var(--background)' : 'var(--foreground)';

	return (
		<div
			role="status"
			aria-label="Loading"
			className={cn(
				'inline-block animate-spin rounded-full motion-reduce:animate-none',
				className,
			)}
			style={{
				width: sizePx,
				height: sizePx,
				borderWidth: `${border}px`,
				borderStyle: 'solid',
				// 3/4 of the ring sits at 20% opacity, top edge solid — gives
				// the rotation something to track without shouting.
				borderColor: `color-mix(in oklch, ${baseColor} 20%, transparent)`,
				borderTopColor: baseColor,
				animationDuration: '0.8s',
				...style,
			}}
			{...props}
		/>
	);
}
