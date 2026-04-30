import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Enterprise pricing card primitives.
 *
 * Flat surfaces, hairline borders, no neon gradients. The brand yellow is
 * reserved for the "popular" `Badge` and any primary CTA placed inside
 * the card by the caller — not for headers, glass effects, or wash.
 */

function Card({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			className={cn(
				'bg-card relative w-full max-w-xs rounded-lg border border-border',
				'p-1.5',
				className,
			)}
			{...props}
		/>
	);
}

function Header({
	className,
	children,
	// `glassEffect` is preserved as a prop for backwards compatibility with
	// existing callers, but it intentionally no longer renders any glass
	// gradient — the redesign drops decorative glass.
	glassEffect: _glassEffect = true,
	...props
}: React.ComponentProps<'div'> & {
	glassEffect?: boolean;
}) {
	return (
		<div
			className={cn(
				'relative mb-4 rounded-md border border-border bg-muted/40 p-4',
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

function Plan({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			className={cn('mb-8 flex items-center justify-between', className)}
			{...props}
		/>
	);
}

function Description({ className, ...props }: React.ComponentProps<'p'>) {
	return (
		<p className={cn('text-muted-foreground text-xs', className)} {...props} />
	);
}

function PlanName({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			className={cn(
				"text-muted-foreground flex items-center gap-2 text-sm font-medium [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * The "popular" pill. This is the single place brand-yellow is allowed
 * inside the pricing card. Use `<Badge variant="default" />` for neutral
 * tags; this dedicated component carries the brand spark.
 */
function Badge({ className, ...props }: React.ComponentProps<'span'>) {
	return (
		<span
			className={cn(
				'border-transparent bg-brand text-brand-foreground rounded-full px-2 py-0.5 text-[11px] font-medium',
				className,
			)}
			{...props}
		/>
	);
}

function Price({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div className={cn('mb-3 flex items-end gap-1', className)} {...props} />
	);
}

function MainPrice({ className, ...props }: React.ComponentProps<'span'>) {
	return (
		<span
			className={cn('text-3xl font-semibold tracking-tight text-foreground', className)}
			{...props}
		/>
	);
}

function Period({ className, ...props }: React.ComponentProps<'span'>) {
	return (
		<span
			className={cn('text-muted-foreground pb-1 text-sm', className)}
			{...props}
		/>
	);
}

function OriginalPrice({ className, ...props }: React.ComponentProps<'span'>) {
	return (
		<span
			className={cn(
				'text-muted-foreground mr-1 ml-auto text-lg line-through',
				className,
			)}
			{...props}
		/>
	);
}

function Body({ className, ...props }: React.ComponentProps<'div'>) {
	return <div className={cn('space-y-6 p-3', className)} {...props} />;
}

function List({ className, ...props }: React.ComponentProps<'ul'>) {
	return <ul className={cn('space-y-3', className)} {...props} />;
}

function ListItem({ className, ...props }: React.ComponentProps<'li'>) {
	return (
		<li
			className={cn(
				'text-muted-foreground flex items-start gap-3 text-sm',
				className,
			)}
			{...props}
		/>
	);
}

function Separator({
	children = 'Upgrade to access',
	className,
	...props
}: React.ComponentProps<'div'> & {
	children?: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'text-muted-foreground flex items-center gap-3 text-xs',
				className,
			)}
			{...props}
		>
			<span className="bg-border h-px flex-1" />
			<span className="text-muted-foreground shrink-0">{children}</span>
			<span className="bg-border h-px flex-1" />
		</div>
	);
}

export {
	Card,
	Header,
	Description,
	Plan,
	PlanName,
	Badge,
	Price,
	MainPrice,
	Period,
	OriginalPrice,
	Body,
	List,
	ListItem,
	Separator,
};
