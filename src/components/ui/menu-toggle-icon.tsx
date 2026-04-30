'use client';
import React from 'react';
import { cn } from '@/lib/utils';

type MenuToggleProps = React.ComponentProps<'svg'> & {
	open: boolean;
	duration?: number;
};

/**
 * MenuToggleIcon — clean morphing hamburger / close icon.
 *
 * SVG path interpolation morphs three lines into an X without a "spin"
 * gimmick. The brief calls for 150–200ms motion as standard; we default
 * to 180ms here, but the `duration` prop is preserved for legacy
 * call sites that pass an explicit value. `motion-reduce` removes the
 * animation entirely for users who prefer it.
 */
export function MenuToggleIcon({
	open,
	className,
	fill = 'none',
	stroke = 'currentColor',
	strokeWidth = 2,
	strokeLinecap = 'round',
	strokeLinejoin = 'round',
	duration = 180,
	...props
}: MenuToggleProps) {
	return (
		<svg
			strokeWidth={strokeWidth}
			fill={fill}
			stroke={stroke}
			viewBox="0 0 32 32"
			strokeLinecap={strokeLinecap}
			strokeLinejoin={strokeLinejoin}
			className={cn(
				'transition-transform ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
				open && '-rotate-45',
				className,
			)}
			style={{
				transitionDuration: `${duration}ms`,
			}}
			{...props}
		>
			<path
				className={cn(
					'transition-all ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
					open
						? '[stroke-dasharray:20_300] [stroke-dashoffset:-32.42px]'
						: '[stroke-dasharray:12_63]',
				)}
				style={{
					transitionDuration: `${duration}ms`,
				}}
				d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
			/>
			<path d="M7 16 27 16" />
		</svg>
	);
}
