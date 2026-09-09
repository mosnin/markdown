import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { CONTACT_EMAIL, ISSUES_URL } from "@/lib/site/contact";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Overview" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/product#coordination", label: "Multi-agent" },
      { href: "/pricing", label: "Pricing" },
      { href: "/sign_in", label: "Start free" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs#hooks", label: "Hooks reference" },
      { href: "/docs#mcp", label: "MCP tools" },
      { href: "/docs#api", label: "HTTP API" },
      {
        href: "https://github.com/mosnin/poggle",
        label: "GitHub",
        external: true,
      },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/changelog", label: "What changed" },
      { href: "/security", label: "Security" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
  {
    title: "Contact",
    links: [
      { href: ISSUES_URL, label: "Open an issue", external: true },
      ...(CONTACT_EMAIL
        ? [
            {
              href: `mailto:${CONTACT_EMAIL}`,
              label: CONTACT_EMAIL,
              external: true,
            },
          ]
        : []),
      { href: "/security", label: "Report a security problem" },
    ],
  },
] as const;

export function MarketingFooter(): ReactNode {
  return (
    <footer className="border-t border-border">
      <div className="mk-container flex flex-col gap-12 py-12 lg:py-12">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div className="flex flex-col gap-6">
            <Link
              href="/"
              aria-label="Poggle home"
              className="focus-ring-canvas inline-flex w-fit items-center gap-4 rounded-4 text-ink focus-visible:outline-none"
            >
              {/* Founder-approved glass brand artwork, isolated from the
                  social image; the footer itself keeps its solid theme ground. */}
              <Image
                src="/icon.svg"
                alt="Poggle"
                width={112}
                height={112}
                sizes="112px"
                className="size-[112px] object-contain"
              />
            </Link>
            <p className="t-body max-w-[40ch] text-ink-2">
              A shared workspace for company knowledge, daily work and the AI
              tools that help your team.
            </p>
            <div className="w-fit">
              <ThemeToggle />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <div key={column.title} className="flex flex-col gap-6">
                <p className="t-label-caps text-ink-3">{column.title}</p>
                <ul className="flex flex-col gap-4">
                  {column.links.map((link) =>
                    "external" in link && link.external ? (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="t-body focus-ring-canvas rounded-2 text-ink-2 transition-colors duration-[var(--dur-1)] hover:text-ink focus-visible:outline-none"
                        >
                          {link.label}
                        </a>
                      </li>
                    ) : (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="t-body focus-ring-canvas rounded-2 text-ink-2 transition-colors duration-[var(--dur-1)] hover:text-ink focus-visible:outline-none"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-hairline pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="t-caption text-ink-3">
            {new Date().getFullYear()} Poggle. Shared memory for coding agents.
          </p>
          <p className="t-caption text-ink-3">
            Built for people, agents, and autonomous companies.
          </p>
        </div>
      </div>
    </footer>
  );
}
