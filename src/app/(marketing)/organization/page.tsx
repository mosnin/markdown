import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  FolderTree,
  GitBranch,
  GitMerge,
  Network,
  Tag,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { ContextModel } from "@/components/marketing/context_model";
import { DataConnections } from "@/components/marketing/data_connections";
import { TiltCard } from "@/components/marketing/tilt_card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Organization — Poggle",
  description:
    "Organize knowledge into boxes and folders, let agents draft on isolated branches, and connect everything in a living knowledge graph — promoted to your source of truth only when you approve.",
};

const FEATURES = [
  {
    icon: Boxes,
    title: "Boxes",
    body: "The unit of organization and access. Group related knowledge, set agent instructions per box, and scope every connection to exactly the boxes it needs.",
  },
  {
    icon: FolderTree,
    title: "Folders",
    body: "Nest notes into folders within a box for structure that scales from a handful of notes to a whole domain.",
  },
  {
    icon: GitBranch,
    title: "Branches",
    body: "Agents draft on isolated branches that never touch the main thread. Work in progress stays invisible to the source of truth until promoted.",
  },
  {
    icon: Network,
    title: "Knowledge graph",
    body: "Notes, entities, and links form a graph agents traverse to assemble precise context — not a flat pile of documents.",
  },
  {
    icon: Tag,
    title: "Entities & links",
    body: "Extract the people, systems, and concepts that recur, and let relationships between notes surface automatically.",
  },
  {
    icon: GitMerge,
    title: "Promote to main",
    body: "When a branch is ready, a human promotes it. That's the only way drafted work reaches your canonical knowledge.",
  },
];

export default function OrganizationPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Organization"
        title="Boxes, branches, and a living knowledge graph."
        description="Structure knowledge the way teams actually think — and let agents draft on branches that only reach your source of truth when you promote them."
        ctaPrimary={{ label: "Start free", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "Explore the platform", href: "/features" }}
      />

      {/* Branch split */}
      <MarketingSection className="border-b border-border/30">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeader
            eyebrow="Branch like code"
            title="Drafts that can't leak into the truth."
            lede="Agents propose on branches, not on main. You see the work in progress, review it as a diff, and promote it only when it's right — exactly the model engineers already trust."
          />
          {/* Branch/merge visual */}
          <BentoCard>
            <div className="space-y-6 py-2">
              {/* main line */}
              <div className="relative flex items-center gap-3">
                <span className="size-3 rounded-full bg-violet-500" />
                <div className="h-0.5 flex-1 bg-violet-500/40" />
                <span className="size-3 rounded-full bg-violet-500" />
                <div className="h-0.5 flex-1 bg-violet-500/40" />
                <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-500">
                  <GitMerge className="size-3" aria-hidden="true" /> main
                </span>
              </div>
              {/* branch line */}
              <div className="relative ml-6 flex items-center gap-3">
                <span className="size-2.5 rounded-full border-2 border-border bg-card" />
                <div className="h-0.5 flex-1 border-t border-dashed border-border" />
                <span className="size-2.5 rounded-full border-2 border-border bg-card" />
                <div className="h-0.5 flex-1 border-t border-dashed border-border" />
                <span className="flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <GitBranch className="size-3" aria-hidden="true" /> agent draft
                </span>
              </div>
              <p className="text-center text-[12px] text-muted-foreground">
                The branch merges to main <span className="font-medium text-foreground">only when you promote it.</span>
              </p>
            </div>
          </BentoCard>
        </div>
      </MarketingSection>

      {/* Context model */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="The shape of your context"
          title="Workspace, boxes, folders, notes."
          lede="A structure agents can navigate and teams can maintain — with one guide note per box that agents read first."
        />
        <div className="mt-12">
          <ContextModel />
        </div>
      </MarketingSection>

      {/* How knowledge connects */}
      <MarketingSection className="border-b border-border/30">
        <SectionHeader
          eyebrow="Connected knowledge"
          title="Not a pile of docs — a graph."
          lede="Entities tie notes together, every change traces back to its decision, and one thread can span boxes. Here's how data connects inside Poggle."
        />
        <div className="mt-12">
          <DataConnections />
        </div>
      </MarketingSection>

      {/* Capabilities bento */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader
          eyebrow="How it's organized"
          title="Structure agents can navigate, teams can maintain."
        />
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <TiltCard key={f.title}>
                <IconTile>
                  <Icon className="size-5" aria-hidden="true" />
                </IconTile>
                <h3 className="mt-5 font-hero text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </TiltCard>
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
              Organize once. Trust it forever.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/80 sm:text-lg">
              Boxes, branches, and a knowledge graph — free to start.
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
