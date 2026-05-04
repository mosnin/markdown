import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Box,
  Boxes,
  CheckCircle2,
  Code2,
  Compass,
  GitBranch,
  Layers,
  LifeBuoy,
  Lock,
  Mail,
  Network,
  Puzzle,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Documentation & Help — Poggle",
  description:
    "Everything you need to ship with Poggle: getting started, the API and MCP, security, and the deeper concepts that make the product work.",
};

interface SectionLink {
  label: string;
  href: string;
  body: string;
  icon: React.ElementType;
}

interface Section {
  eyebrow: string;
  title: string;
  description: string;
  links: SectionLink[];
}

const SECTIONS: Section[] = [
  {
    eyebrow: "Start here",
    title: "Getting started",
    description:
      "From sign-up to your first AI bundle in fifteen minutes. Read in order, or jump straight to the part that matches what you're building.",
    links: [
      {
        label: "Quickstart",
        href: "https://docs.poggle.app/quickstart",
        body: "Sign in, make a box, write a note, and bundle it for an AI in five steps.",
        icon: Rocket,
      },
      {
        label: "Concepts: boxes, notes, links",
        href: "/notes-and-files",
        body: "The smallest mental model that unlocks the rest of the product.",
        icon: Compass,
      },
      {
        label: "Concepts: skills & agents",
        href: "/skills-and-agents",
        body: "Real package structure for the work you do with AI — not flat blobs.",
        icon: Puzzle,
      },
      {
        label: "Importing from Obsidian / Notion",
        href: "/portability",
        body: "Bring your existing knowledge in. Export back out at any time.",
        icon: Boxes,
      },
    ],
  },
  {
    eyebrow: "Build",
    title: "API, MCP, and integrations",
    description:
      "Everything you need to script Poggle, ship MCP tools, and wire it into the rest of your stack.",
    links: [
      {
        label: "REST API v1 reference",
        href: "/api",
        body: "OAuth 2.1 authentication, scoped tokens, rate limits, and every endpoint.",
        icon: Code2,
      },
      {
        label: "Model Context Protocol (MCP)",
        href: "https://docs.poggle.app/mcp",
        body: "First-class MCP server. Plug Poggle into Claude, Cursor, or any MCP-aware client.",
        icon: Terminal,
      },
      {
        label: "Connections & permissions",
        href: "/connections",
        body: "Per-connection scopes, write-with-approval mode, audit log on every call.",
        icon: Network,
      },
      {
        label: "Branch-aware writes",
        href: "https://docs.poggle.app/branches",
        body: "How AI writes land on a branch first, with diff review and optional CI gates.",
        icon: GitBranch,
      },
    ],
  },
  {
    eyebrow: "Operate",
    title: "Trust, security, and governance",
    description:
      "What we built so this product can be trusted with the work — and the controls available to your team.",
    links: [
      {
        label: "Trust & security overview",
        href: "/trust",
        body: "Eight pillars: data isolation, auth, keys, audit, branches, encryption, network, portability.",
        icon: ShieldCheck,
      },
      {
        label: "Privacy policy",
        href: "/privacy",
        body: "What we collect, what we don't, and how to ask for everything back.",
        icon: Lock,
      },
      {
        label: "Acceptable use",
        href: "/acceptable-use",
        body: "The short list of things you cannot do with Poggle.",
        icon: CheckCircle2,
      },
      {
        label: "Organization & team controls",
        href: "/organization",
        body: "Members, roles, retention, and enterprise SSO / SCIM.",
        icon: Layers,
      },
    ],
  },
  {
    eyebrow: "Reference",
    title: "Deep dives",
    description:
      "When you want the full architecture story — for a security review, a build-vs-buy decision, or just curiosity.",
    links: [
      {
        label: "Architecture overview",
        href: "https://docs.poggle.app/architecture",
        body: "Hex/onion separation, server components, RLS, MCP, workers, and CRDT.",
        icon: Layers,
      },
      {
        label: "Knowledge graph",
        href: "/skills-and-agents",
        body: "Entities, semantic links, and the GraphRAG context the operator agent uses.",
        icon: Network,
      },
      {
        label: "Agents & operators",
        href: "/skills-and-agents",
        body: "How long-running agents run on a branch, propose writes, and report back.",
        icon: Bot,
      },
      {
        label: "Object lifecycle",
        href: "https://docs.poggle.app/lifecycle",
        body: "Draft → active → archived → trashed, plus version history on every object.",
        icon: Box,
      },
    ],
  },
];

function SectionBlock({ section }: { section: Section }) {
  return (
    <section className="border-t border-border bg-background px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 max-w-2xl">
          <p className="text-overline text-brand">{section.eyebrow}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {section.title}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {section.description}
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 list-none">
          {section.links.map(({ label, href, body, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="group block h-full rounded-lg border border-border bg-card p-5 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      <span className="brand-underline">{label}</span>
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {body}
                    </p>
                  </div>
                  <ArrowRight
                    className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <main>
      <PageHeroSection
        eyebrow="Documentation"
        title="Everything you need to ship."
        description="The complete index — getting started, API reference, MCP integration, security, and the architecture story behind it."
        ctaPrimary={{ label: "Quickstart", href: "https://docs.poggle.app/quickstart" }}
        ctaSecondary={{ label: "API reference", href: "/api" }}
      />

      {SECTIONS.map((section) => (
        <SectionBlock key={section.title} section={section} />
      ))}

      {/* Support */}
      <section className="border-t border-border bg-muted/30 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <LifeBuoy
            className="mx-auto h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Stuck? We're a fast email away.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Most replies inside one business day. Security questions go to a
            dedicated address with the SIG-Lite, DPA, and architecture
            diagrams pre-loaded.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              variant="default"
              render={<Link href="mailto:support@poggle.app" />}
            >
              <Mail className="size-4" data-icon="inline-start" />
              support@poggle.app
            </Button>
            <Button
              size="lg"
              variant="ghost"
              render={<Link href="/trust" />}
            >
              <Sparkles className="size-4" data-icon="inline-start" />
              Read the trust overview
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
