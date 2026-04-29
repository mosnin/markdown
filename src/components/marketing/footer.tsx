import Link from "next/link";
import Image from "next/image";

const LINKS = {
  Product: [
    { href: "/features", label: "Features" },
    { href: "/notes-and-files", label: "Notes & Files" },
    { href: "/skills-and-agents", label: "Skills & Agents" },
    { href: "/connections", label: "Connections" },
    { href: "/pricing", label: "Pricing" },
  ],
  Developers: [
    { href: "https://docs.atlas.app", label: "Documentation" },
    { href: "/api", label: "API & MCP" },
    { href: "/portability", label: "Import & Export" },
    { href: "/changelog", label: "Changelog" },
  ],
  Company: [
    { href: "/about", label: "About" },
    { href: "/how-it-works", label: "How It Works" },
    { href: "/blog", label: "Blog" },
    { href: "/help", label: "Help Center" },
  ],
  Legal: [
    { href: "/terms", label: "Terms of Service" },
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/cookies", label: "Cookie Policy" },
    { href: "/acceptable-use", label: "Acceptable Use" },
    { href: "/refund-policy", label: "Refund Policy" },
    { href: "/dmca", label: "DMCA" },
  ],
};

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/50 bg-background">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:grid-cols-5">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <Image src="/logo-symbol-dark.png" alt="Atlas" width={28} height={28} className="rounded dark:hidden" />
              <Image src="/logo-symbol-light.png" alt="Atlas" width={28} height={28} className="rounded hidden dark:block" />
              <Image src="/logo-text-black.png" alt="Atlas" width={64} height={22} className="dark:hidden" />
              <Image src="/logo-text-white.png" alt="Atlas" width={64} height={22} className="hidden dark:block" />
            </div>
            <p className="mt-4 max-w-[200px] text-xs leading-relaxed text-muted-foreground">
              A markdown-native context operating system for humans and AI.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([group, links]) => (
            <div key={group}>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {group}
              </p>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border/50 pt-8 sm:flex-row sm:items-center">
          {/*
           * `new Date().getFullYear()` is hydration-safe here: this is a
           * server component (no "use client"), so it only runs on the
           * server. The rendered HTML ships to the client as static markup
           * and is never re-evaluated during hydration, so server/client
           * cannot disagree.
           */}
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Atlas. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {[
              { href: "/terms", label: "Terms" },
              { href: "/privacy", label: "Privacy" },
              { href: "/cookies", label: "Cookies" },
              { href: "/acceptable-use", label: "Acceptable Use" },
              { href: "/refund-policy", label: "Refunds" },
              { href: "/dmca", label: "DMCA" },
            ].map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="transition-colors hover:text-foreground"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
