import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Download,
  FileText,
  FileJson,
  History,
  LockOpen,
  ShieldCheck,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Portability — Poggle",
  description:
    "Everything in Poggle is plain markdown you can export anytime — open formats, full history, no lock-in. Your knowledge is always yours.",
};

const FEATURES = [
  { icon: FileText, title: "Plain markdown", body: "Notes are markdown with simple front-matter — open it in any editor, commit it to any repo." },
  { icon: Download, title: "One-click export", body: "Export a box or your whole workspace as a clean folder of markdown, anytime, without asking anyone." },
  { icon: FileJson, title: "Open formats", body: "Markdown for content, JSON for structure. Nothing proprietary, nothing you can't read yourself." },
  { icon: History, title: "History included", body: "Exports carry version history, so the record of how knowledge evolved comes with you." },
  { icon: LockOpen, title: "No lock-in", body: "No proprietary blob, no contract to escape. Leaving is as easy as a download — which is exactly why you won't want to." },
  { icon: ShieldCheck, title: "You own the data", body: "Your workspace is yours. We're the trust gate, not the owner of your source of truth." },
];

export default function PortabilityPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Portability"
        title="Your knowledge, never held hostage."
        description="Everything in Poggle is plain markdown in open formats. Export a box or the whole workspace whenever you like — history and all. No lock-in, ever."
        ctaPrimary={{ label: "Start free", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "Explore the platform", href: "/features" }}
      />

      {/* Split */}
      <MarketingSection className="border-b border-border/30">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeader
            eyebrow="Open by default"
            title="Plain markdown, all the way down."
            lede="The format you can read is the format we store. There's no export step that loses fidelity, because there's nothing proprietary to lose."
          />
          {/* Markdown file visual */}
          <BentoCard className="p-0">
            <div className="flex items-center gap-2 border-b border-border/50 px-5 py-3">
              <FileText className="size-4 text-violet-500" aria-hidden="true" />
              <span className="font-mono text-[12px] text-foreground">architecture.md</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">markdown</span>
            </div>
            <div className="px-5 py-4 font-mono text-[12px] leading-relaxed">
              <p className="text-muted-foreground/70">---</p>
              <p><span className="text-violet-500">box:</span> Engineering</p>
              <p><span className="text-violet-500">tags:</span> [decision, api]</p>
              <p className="text-muted-foreground/70">---</p>
              <p className="mt-1 font-semibold text-foreground"># API Architecture</p>
              <p className="text-foreground/70">Caching: read-through, 5-minute TTL.</p>
            </div>
            <div className="flex items-center gap-2 border-t border-border/50 px-5 py-3 text-[11px] text-muted-foreground">
              <Download className="size-3.5 text-violet-500" aria-hidden="true" />
              Export this box → a folder of files exactly like this one.
            </div>
          </BentoCard>
        </div>
      </MarketingSection>

      {/* Capabilities */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader eyebrow="Why it matters" title="Trust starts with the freedom to leave." />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <BentoCard key={f.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </BentoCard>
            );
          })}
        </div>
      </MarketingSection>

      {/* CTA */}
      <MarketingSection>
        <BentoCard tone="gradient" className="px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -left-10 -top-10 size-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-hero text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Knowledge you can always take with you.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/80 sm:text-lg">
              Start free. Export anytime. Owe us nothing but the value we earn.
            </p>
            <div className="mt-9 flex justify-center">
              <Button
                size="lg"
                className="rounded-full bg-white text-violet-700 hover:bg-white/90"
                render={<Link href="/sign_in?mode=signup" />}
              >
                Get started free
                <ArrowRight className="ml-2 size-4" data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </BentoCard>
      </MarketingSection>
    </div>
  );
}
