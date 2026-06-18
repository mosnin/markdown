import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CreditCard, Plug, ShieldCheck } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { Faq } from "@/components/marketing/faq";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Help — Poggle",
  description: "Guides, FAQs, and support for Poggle — the governed context layer for AI agents.",
};

const QUICK_LINKS = [
  { icon: BookOpen, title: "Getting started", body: "Set up a workspace and approve your first proposal.", href: "/how-it-works" },
  { icon: Plug, title: "Connecting agents", body: "Connect any MCP client with a scoped token.", href: "/connections" },
  { icon: CreditCard, title: "Billing & plans", body: "Free, Pro, and Team — what's included.", href: "/pricing" },
  { icon: ShieldCheck, title: "Security & data", body: "How the trust gate and audit log work.", href: "/features" },
];

const FAQ = [
  {
    q: "What is Poggle?",
    a: "Poggle is a governed context layer for AI agents — a trust gate between your agents and your source of truth. Agents connect over MCP, read the context you allow, and submit changes as proposals you approve. Nothing is written directly.",
  },
  {
    q: "Can an agent change my notes directly?",
    a: "No. Connected agents have read access but cannot mutate anything. The only path in is a proposal — a reviewable diff — that a human approves, edits, or rejects.",
  },
  {
    q: "How do agents connect?",
    a: "Over the Model Context Protocol, using OAuth 2.1 + PKCE. You issue a token scoped to specific boxes and capabilities, and you can rotate or revoke it at any time.",
  },
  {
    q: "Which agents work with Poggle?",
    a: "Anything that speaks MCP — Claude, Cursor, and your own agents included. There's no plugin to install or adapter to maintain.",
  },
  {
    q: "Is my data portable?",
    a: "Yes. Everything is plain markdown in open formats. Export a box or your entire workspace — history included — whenever you like. No lock-in.",
  },
  {
    q: "How does pricing work?",
    a: "Start free with your first agent connection and three boxes. Upgrade to Pro for unlimited agents and a full audit trail, or Team for shared, governed workspaces. See the pricing page for details.",
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Help"
        title="How can we help?"
        description="Start with the guides below, browse the common questions, or reach out — we read every message."
      />

      {/* Quick links */}
      <MarketingSection className="border-b border-border/30">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {QUICK_LINKS.map((q) => {
            const Icon = q.icon;
            return (
              <Link key={q.title} href={q.href} className="group">
                <BentoCard className="h-full">
                  <div className="flex items-start gap-4">
                    <IconTile>
                      <Icon className="size-5" aria-hidden="true" />
                    </IconTile>
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 font-hero text-lg font-semibold text-foreground">
                        {q.title}
                        <ArrowRight className="size-4 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-violet-500" aria-hidden="true" />
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{q.body}</p>
                    </div>
                  </div>
                </BentoCard>
              </Link>
            );
          })}
        </div>
      </MarketingSection>

      {/* FAQ */}
      <MarketingSection muted className="border-b border-border/30">
        <div className="mx-auto max-w-3xl">
          <SectionHeader align="center" eyebrow="FAQ" title="Common questions." className="mb-10" />
          <Faq items={FAQ} />
        </div>
      </MarketingSection>

      {/* Contact */}
      <MarketingSection>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-hero text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Still stuck?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-base text-muted-foreground">
            Email us and a human — never a bot — will get back to you.
          </p>
          <div className="mt-7 flex justify-center">
            <Button
              size="lg"
              className="rounded-full"
              render={<a href="mailto:hello@poggle.app?subject=Poggle%20support" />}
            >
              Contact support
              <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </MarketingSection>
    </div>
  );
}
