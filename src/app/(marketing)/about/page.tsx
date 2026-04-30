import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Hexagon, Zap, Sparkle, Aperture, Check } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "About — Poggle",
  description:
    "We're building the context layer between human knowledge and AI reasoning.",
};

const STATS = [
  { value: "2023", label: "Founded" },
  { value: "10k+", label: "Active users" },
  { value: "3", label: "Team members" },
  { value: "∞", label: "Notes stored" },
];

const VALUES = [
  {
    icon: Hexagon,
    title: "Structure over chaos",
    description:
      "Unstructured notes are noise. We believe knowledge should have shape — semantic containers, clear relationships, and a consistent grammar for capturing thinking.",
  },
  {
    icon: Zap,
    title: "AI as a collaborator",
    description:
      "AI doesn't replace thinking — it amplifies it. Poggle exists to make the handoff between your knowledge and your AI as seamless as possible.",
  },
  {
    icon: Sparkle,
    title: "Durability first",
    description:
      "Your knowledge should outlive the tools you use to create it. We use plain markdown, open formats, and unrestricted export — always.",
  },
  {
    icon: Aperture,
    title: "Radical transparency",
    description:
      "No black-box AI editing your notes. No opaque pricing. No data used for training. What you put in is exactly what you get out.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="About"
        title={
          <>
            Building the context layer
            <br className="hidden sm:block" /> between knowledge and AI
          </>
        }
      />

      {/* Mission */}
      <section className="py-20">
        <div className="mx-auto max-w-2xl px-6">
          <div className="space-y-5 text-base leading-relaxed text-muted-foreground">
            <p>
              Poggle started with a simple frustration: every time we started a
              conversation with an AI, we spent the first five minutes copying,
              pasting, and curating context from dozens of scattered notes. The
              AI was capable — but it was flying blind.
            </p>
            <p>
              We realized the missing piece wasn&apos;t a smarter model. It was a{" "}
              <span className="font-medium text-foreground">
                structured home for knowledge
              </span>{" "}
              — one that understood the shape of your thinking and could
              assemble exactly the right context for any task.
            </p>
            <p>
              Poggle is that home. It&apos;s built on plain markdown, organized
              into semantic containers, and designed from day one to produce
              AI-ready context bundles. Write once, use everywhere — in your
              notes, in your prompts, and in your team&apos;s shared
              understanding.
            </p>
            <p>
              We&apos;re a small, focused team. We care deeply about durability,
              transparency, and giving knowledge workers a tool that respects
              their thinking rather than trying to replace it.
            </p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-muted/30 py-14">
        <div className="mx-auto max-w-3xl px-6">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-semibold tracking-tight text-foreground">
                  {s.value}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-10">
            <p className="text-overline text-brand mb-2">Values</p>
            <h2 className="text-headline text-foreground">What we believe</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {VALUES.map((v) => (
              <Card key={v.title}>
                <CardHeader>
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                    <v.icon className="h-4.5 w-4.5 text-muted-foreground" />
                  </div>
                  <CardTitle>{v.title}</CardTitle>
                  <CardDescription>{v.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Built in the open */}
      <section className="border-y border-border bg-muted/30 py-14">
        <div className="mx-auto max-w-2xl px-6">
          <p className="text-overline text-brand mb-2">Principles</p>
          <h2 className="mb-6 text-headline text-foreground">
            Principles we ship by
          </h2>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              "Your data is yours — export everything, anytime, no friction.",
              "Plain markdown files, always. No proprietary formats.",
              "We don't train on your content. Ever.",
              "Pricing is public, permanent, and honest.",
              "If we can't explain a feature plainly, we don't build it.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand"
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-headline text-foreground">Join us</h2>
          <p className="mt-3 text-base text-muted-foreground">
            Whether you&apos;re organizing a solo knowledge base or building AI
            context for a team — we built Poggle for you.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" render={<Link href="/sign_in" />}>
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Link
              href="/contact"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Get in touch →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
