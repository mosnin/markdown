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
    <header className="fixed top-4 left-0 right-0 z-50 flex flex-col items-center px-4">
      {/* Pill nav */}
      <div className="flex w-full max-w-5xl items-center justify-between rounded-2xl border border-border/60 bg-background/85 px-4 py-2.5 shadow-lg shadow-black/5 backdrop-blur-md">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 focus-visible:outline-none">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
            <div className="h-2.5 w-2.5 rounded-sm bg-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Context Store</span>
        </Link>

        {/* Center nav (desktop) */}
        <nav className="hidden items-center gap-0.5 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <Link
            href="/sign_in"
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:block"
          >
            Sign in
          </Link>
          <Link
            href="/sign_in"
            className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-500"
          >
            Get started
          </Link>
          {/* Mobile menu button */}
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="mt-2 w-full max-w-5xl rounded-2xl border border-border/60 bg-background/95 p-3 shadow-xl shadow-black/10 backdrop-blur-md md:hidden">
          <nav className="flex flex-col gap-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-1 border-t border-border" />
            <Link
              href="/sign_in"
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
