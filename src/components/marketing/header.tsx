'use client';
import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { createPortal } from 'react-dom';

type NavLink = { title: string; href: string };

const NAV_LINKS: NavLink[] = [
	{ title: 'Features', href: '/features' },
	{ title: 'Pricing', href: '/pricing' },
	{ title: 'Docs', href: 'https://docs.poggle.app' },
	{ title: 'Blog', href: '/blog' },
	{ title: 'Changelog', href: '/changelog' },
];

export function MarketingHeader() {
	const [open, setOpen] = React.useState(false);
	const scrolled = useScroll(8);

	React.useEffect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [open]);

	return (
		<header
			className={cn(
				'sticky top-0 z-50 w-full border-b transition-colors duration-150',
				scrolled
					? 'border-border bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70'
					: 'border-transparent bg-background',
			)}
		>
			<nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
				{/* Brand mark */}
				<div className="flex items-center gap-8">
					<Link
						href="/"
						className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:opacity-90"
						aria-label="Poggle home"
					>
						<span
							aria-hidden
							className="inline-block size-4 rounded-[3px] bg-brand"
						/>
						<span className="text-[15px] font-semibold tracking-tight text-foreground">
							Poggle
						</span>
					</Link>

					{/* Center nav */}
					<ul className="hidden items-center gap-1 md:flex">
						{NAV_LINKS.map((link) => (
							<li key={link.href}>
								<Link
									href={link.href}
									className={cn(
										'rounded-md px-3 py-1.5 text-sm text-muted-foreground',
										'transition-colors hover:text-foreground',
									)}
								>
									{link.title}
								</Link>
							</li>
						))}
					</ul>
				</div>

				{/* Right CTAs */}
				<div className="hidden items-center gap-2 md:flex">
					<Button variant="ghost" size="sm" render={<Link href="/sign_in" />}>
						Sign in
					</Button>
					<Button variant="brand" size="sm" render={<Link href="/sign_in" />}>
						Get started
					</Button>
				</div>

				{/* Mobile toggle */}
				<Button
					size="icon"
					variant="outline"
					onClick={() => setOpen(!open)}
					className="md:hidden"
					aria-expanded={open}
					aria-controls="mobile-menu"
					aria-label="Toggle menu"
				>
					<MenuToggleIcon open={open} className="size-5" duration={300} />
				</Button>
			</nav>

			<MobileMenu open={open} onNavigate={() => setOpen(false)} />
		</header>
	);
}

function MobileMenu({
	open,
	onNavigate,
}: {
	open: boolean;
	onNavigate: () => void;
}) {
	if (!open || typeof window === 'undefined') return null;

	return createPortal(
		<div
			id="mobile-menu"
			className={cn(
				'fixed top-14 right-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden md:hidden',
				'border-t border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md',
			)}
		>
			<div className="flex flex-1 flex-col justify-between gap-6 p-6">
				<ul className="flex flex-col gap-1">
					{NAV_LINKS.map((link) => (
						<li key={link.href}>
							<Link
								href={link.href}
								onClick={onNavigate}
								className="block rounded-md px-3 py-2.5 text-base text-foreground hover:bg-accent"
							>
								{link.title}
							</Link>
						</li>
					))}
				</ul>
				<div className="flex flex-col gap-2">
					<Button
						variant="outline"
						className="w-full"
						render={<Link href="/sign_in" />}
					>
						Sign in
					</Button>
					<Button variant="brand" className="w-full" render={<Link href="/sign_in" />}>
						Get started
					</Button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function useScroll(threshold: number) {
	const [scrolled, setScrolled] = React.useState(false);

	const onScroll = React.useCallback(() => {
		setScrolled(window.scrollY > threshold);
	}, [threshold]);

	React.useEffect(() => {
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, [onScroll]);

	React.useEffect(() => {
		onScroll();
	}, [onScroll]);

	return scrolled;
}
