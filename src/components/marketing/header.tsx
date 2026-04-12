'use client';
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { createPortal } from 'react-dom';
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';
import { type LucideIcon } from 'lucide-react';
import {
	CodeIcon,
	LayersIcon,
	FileText,
	Shield,
	RotateCcw,
	Leaf,
	HelpCircle,
	BarChart2,
	Archive,
	GitBranch,
	Users,
	Upload,
	BookOpen,
	Star,
} from 'lucide-react';

type LinkItem = {
	title: string;
	href: string;
	icon: LucideIcon;
	description?: string;
};

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
					<NavigationMenu className="hidden md:flex">
						<NavigationMenuList>
							<NavigationMenuItem>
								<NavigationMenuTrigger className="bg-transparent">Product</NavigationMenuTrigger>
								<NavigationMenuContent className="bg-background p-1 pr-1.5">
									<ul className="bg-popover grid w-lg grid-cols-2 gap-2 rounded-md border p-2 shadow">
										{productLinks.map((item, i) => (
											<li key={i}>
												<ListItem {...item} />
											</li>
										))}
									</ul>
									<div className="p-2">
										<p className="text-muted-foreground text-sm">
											Want a closer look?{' '}
											<Link href="/pricing" className="text-foreground font-medium hover:underline">
												View pricing
											</Link>
										</p>
									</div>
								</NavigationMenuContent>
							</NavigationMenuItem>
							<NavigationMenuItem>
								<NavigationMenuTrigger className="bg-transparent">Company</NavigationMenuTrigger>
								<NavigationMenuContent className="bg-background p-1 pr-1.5 pb-1.5">
									<div className="grid w-lg grid-cols-2 gap-2">
										<ul className="bg-popover space-y-2 rounded-md border p-2 shadow">
											{companyLinks.map((item, i) => (
												<li key={i}>
													<ListItem {...item} />
												</li>
											))}
										</ul>
										<ul className="space-y-2 p-3">
											{companyLinks2.map((item, i) => (
												<li key={i}>
													<NavigationMenuLink
														href={item.href}
														className="flex p-2 hover:bg-accent flex-row rounded-md items-center gap-x-2"
													>
														<item.icon className="text-foreground size-4" />
														<span className="font-medium">{item.title}</span>
													</NavigationMenuLink>
												</li>
											))}
										</ul>
									</div>
								</NavigationMenuContent>
							</NavigationMenuItem>
							<NavigationMenuLink className="px-4" asChild>
								<Link href="/pricing" className="hover:bg-accent rounded-md p-2">
									Pricing
								</Link>
							</NavigationMenuLink>
						</NavigationMenuList>
					</NavigationMenu>
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
				<NavigationMenu className="max-w-full">
					<div className="flex w-full flex-col gap-y-2">
						<span className="text-sm">Product</span>
						{productLinks.map((link) => (
							<ListItem key={link.title} {...link} />
						))}
						<span className="text-sm">Company</span>
						{companyLinks.map((link) => (
							<ListItem key={link.title} {...link} />
						))}
						{companyLinks2.map((link) => (
							<ListItem key={link.title} {...link} />
						))}
					</div>
				</NavigationMenu>
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

function ListItem({
	title,
	description,
	icon: Icon,
	className,
	href,
	...props
}: React.ComponentProps<typeof NavigationMenuLink> & LinkItem) {
	return (
		<NavigationMenuLink
			className={cn(
				'w-full flex flex-row gap-x-2 data-[active=true]:focus:bg-accent data-[active=true]:hover:bg-accent data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-sm p-2',
				className,
			)}
			{...props}
			asChild
		>
			<Link href={href}>
				<div className="bg-background/40 flex aspect-square size-12 items-center justify-center rounded-md border shadow-sm">
					<Icon className="text-foreground size-5" />
				</div>
				<div className="flex flex-col items-start justify-center">
					<span className="font-medium">{title}</span>
					<span className="text-muted-foreground text-xs">{description}</span>
				</div>
			</Link>
		</NavigationMenuLink>
	);
}

const productLinks: LinkItem[] = [
	{
		title: 'Notes & Files',
		href: '/notes-and-files',
		description: 'Markdown notes and code artifacts in one place',
		icon: FileText,
	},
	{
		title: 'Boxes & Folders',
		href: '/organization',
		description: 'Organize your work into focused containers',
		icon: Archive,
	},
	{
		title: 'Skills & Agents',
		href: '/skills-and-agents',
		description: 'Reusable modules and orchestrators with real structure',
		icon: LayersIcon,
	},
	{
		title: 'Connections',
		href: '/connections',
		description: 'Typed relationships and interactive graph views',
		icon: GitBranch,
	},
	{
		title: 'API & MCP',
		href: '/api',
		description: 'Programmatic access for your tools and agents',
		icon: CodeIcon,
	},
	{
		title: 'Import & Export',
		href: '/portability',
		description: 'Portable packages you own forever',
		icon: Upload,
	},
];

const companyLinks: LinkItem[] = [
	{
		title: 'About Us',
		href: '/about',
		description: 'Our story and the team behind Poggle',
		icon: Users,
	},
	{
		title: 'Changelog',
		href: '/changelog',
		description: "What's new in each release",
		icon: BarChart2,
	},
	{
		title: 'How It Works',
		href: '/how-it-works',
		description: 'See how Poggle fits into your workflow',
		icon: BookOpen,
	},
];

const companyLinks2: LinkItem[] = [
	{
		title: 'Docs',
		href: 'https://docs.poggle.app',
		icon: BookOpen,
	},
	{
		title: 'Privacy Policy',
		href: '/privacy',
		icon: Shield,
	},
	{
		title: 'Terms of Service',
		href: '/terms',
		icon: FileText,
	},
	{
		title: 'Refund Policy',
		href: '/refund-policy',
		icon: RotateCcw,
	},
	{
		title: 'Blog',
		href: '/blog',
		icon: Leaf,
	},
	{
		title: 'Help Center',
		href: '/help',
		icon: HelpCircle,
	},
];

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

// Suppress unused import warning — Star is kept for potential use
void Star;
