'use client';
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { createPortal } from 'react-dom';

type NavLink = {
	title: string;
	href: string;
};

const navLinks: NavLink[] = [
	{ title: 'How It Works', href: '/how-it-works' },
	{ title: 'Pricing', href: '/pricing' },
];

export function MarketingHeader() {
	const [open, setOpen] = React.useState(false);
	const scrolled = useScroll(10);

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
			className={cn('sticky top-0 z-50 w-full border-b border-transparent', {
				'bg-background/95 supports-[backdrop-filter]:bg-background/50 border-border backdrop-blur-lg':
					scrolled,
			})}
		>
			<nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
				<div className="flex items-center gap-5">
					<Link href="/" className="hover:bg-accent flex items-center gap-2.5 rounded-md px-2 py-1.5">
						<WordmarkLogo />
					</Link>
					<ul className="hidden items-center gap-1 md:flex">
						{navLinks.map((link) => (
							<li key={link.href}>
								<Link
									href={link.href}
									className="hover:bg-accent rounded-md px-3 py-2 text-sm text-foreground"
								>
									{link.title}
								</Link>
							</li>
						))}
					</ul>
				</div>
				<div className="hidden items-center gap-2 md:flex">
					<Button variant="outline" render={<Link href="/sign_in" />}>Sign In</Button>
					<Button render={<Link href="/sign_in" />}>Get Started</Button>
				</div>
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
			<MobileMenu open={open} className="flex flex-col justify-between gap-2 overflow-y-auto">
				<div className="flex w-full flex-col gap-y-1">
					{navLinks.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							onClick={() => setOpen(false)}
							className="hover:bg-accent rounded-md px-3 py-2.5 text-sm font-medium text-foreground"
						>
							{link.title}
						</Link>
					))}
				</div>
				<div className="flex flex-col gap-2">
					<Button variant="outline" className="w-full bg-transparent" render={<Link href="/sign_in" />}>
						Sign In
					</Button>
					<Button className="w-full" render={<Link href="/sign_in" />}>Get Started</Button>
				</div>
			</MobileMenu>
		</header>
	);
}

type MobileMenuProps = React.ComponentProps<'div'> & {
	open: boolean;
};

function MobileMenu({ open, children, className, ...props }: MobileMenuProps) {
	if (!open || typeof window === 'undefined') return null;

	return createPortal(
		<div
			id="mobile-menu"
			className={cn(
				'bg-background/95 supports-[backdrop-filter]:bg-background/50 backdrop-blur-lg',
				'fixed top-14 right-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden border-y md:hidden',
			)}
		>
			<div
				data-slot={open ? 'open' : 'closed'}
				className={cn(
					'data-[slot=open]:animate-in data-[slot=open]:zoom-in-97 ease-out',
					'size-full p-4',
					className,
				)}
				{...props}
			>
				{children}
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
		window.addEventListener('scroll', onScroll);
		return () => window.removeEventListener('scroll', onScroll);
	}, [onScroll]);

	React.useEffect(() => {
		onScroll();
	}, [onScroll]);

	return scrolled;
}

function WordmarkLogo() {
	return (
		<>
			<Image src="/logo-symbol-dark.png" alt="Poggle" width={20} height={20} className="rounded dark:hidden" />
			<Image src="/logo-symbol-light.png" alt="Poggle" width={20} height={20} className="rounded hidden dark:block" />
			<Image src="/logo-text-black.png" alt="Poggle" width={60} height={20} className="dark:hidden" />
			<Image src="/logo-text-white.png" alt="Poggle" width={60} height={20} className="hidden dark:block" />
		</>
	);
}
