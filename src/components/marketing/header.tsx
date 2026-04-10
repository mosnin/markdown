"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export function MarketingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border/20 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 focus-visible:outline-none"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-600">
            <div className="h-2 w-2 rounded-sm bg-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Context Store
          </span>
        </Link>

        {/* Center nav */}
        <nav className="hidden flex-1 items-center gap-0.5 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/sign_in"
            className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:block"
          >
            Sign in
          </Link>
          <Link
            href="/sign_in"
            className="rounded-md bg-violet-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            Get started
          </Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-border/20 bg-background/95 px-6 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col gap-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-1.5 border-t border-border/30" />
            <Link
              href="/sign_in"
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              Sign in
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
