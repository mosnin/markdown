import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";

export const metadata: Metadata = {
  title: "About — Context Store",
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
    icon: "⬡",
    title: "Structure over chaos",
    description:
      "Unstructured notes are noise. We believe knowledge should have shape — semantic containers, clear relationships, and a consistent grammar for capturing thinking.",
  },
  {
    icon: "⚡",
    title: "AI as a collaborator",
    description:
      "AI doesn't replace thinking — it amplifies it. Context Store exists to make the handoff between your knowledge and your AI as seamless as possible.",
  },
  {
    icon: "⊛",
    title: "Durability first",
    description:
      "Your knowledge should outlive the tools you use to create it. We use plain markdown, open formats, and unrestricted export — always.",
  },
  {
    icon: "◎",
    title: "Radical transparency",
    description:
      "No black-box AI editing your notes. No opaque pricing. No data used for training. What you put in is exactly what you get out.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <PageHeroSection
        eyebrow="About"
        title={<>Building the context layer<br className="hidden sm:block" /> between knowledge and AI</>}
      />

      {/* Mission */}
      <section className="py-20">
        <div className="mx-auto max-w-2xl px-6">
          <div className="space-y-5 text-base leading-relaxed text-muted-foreground">
            <p>
              Context Store started with a simple frustration: every time we
              started a conversation with an AI, we spent the first five minutes
              copying, pasting, and curating context from dozens of scattered
              notes. The AI was capable — but it was flying blind.
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
              Context Store is that home. It&apos;s built on plain markdown, organized
              into semantic containers, and designed from day one to produce
              AI-ready context bundles. Write once, use everywhere — in your
              notes, in your prompts, and in your team&apos;s shared understanding.
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
      <section className="border-y border-border/50 bg-muted/20 py-14">
        <div className="mx-auto max-w-3xl px-6">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-bold tracking-tight text-foreground">
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
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              What we believe
            </h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {VALUES.map((v) => (
              <div
                key={v.title}
                className="rounded-xl border border-border/60 bg-card p-6"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 font-mono text-base text-violet-400">
                  {v.icon}
                </div>
                <h3 className="mb-2 font-semibold text-foreground">{v.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {v.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Built in the open */}
      <section className="border-y border-border/50 bg-muted/20 py-14">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="mb-4 text-xl font-bold tracking-tight text-foreground">
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
                <span className="mt-0.5 shrink-0 font-mono text-violet-400">→</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Join us
          </h2>
          <p className="mt-3 text-muted-foreground">
            Whether you&apos;re organizing a solo knowledge base or building AI
            context for a team — we built Context Store for you.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/sign_in"
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
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
