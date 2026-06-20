import type { Metadata } from "next";
import {
  Bot,
  GitFork,
  Puzzle,
  ScrollText,
  Sparkles,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import { PageHeroSection } from "@/components/marketing/hero";
import {
  MarketingSection,
  SectionHeader,
  BentoCard,
  IconTile,
} from "@/components/marketing/sections";
import { CollabSection } from "@/components/marketing/collab_section";
import { MatrixCta } from "@/components/marketing/matrix_cta";

export const metadata: Metadata = {
  title: "Skills & agents — Poggle",
  description:
    "Package reusable skills your agents can call, orchestrate sub-agents in fresh context windows, trigger runs on events, and design multi-step workflows — all governed by the trust gate.",
};

const FEATURES = [
  {
    icon: Puzzle,
    title: "Skills",
    body: "Package a capability once — a prompt, tools, and scope — and let any agent call it. Reusable, versioned, and shareable across the workspace.",
  },
  {
    icon: Bot,
    title: "Sub-agents",
    body: "Each invocation runs in a fresh context window, so the orchestrator's memory stays lean and focused no matter how deep the work goes.",
  },
  {
    icon: Zap,
    title: "Agent triggers",
    body: "Define when an agent runs automatically — on a new note, a schedule, or an event — without a human kicking off every task.",
  },
  {
    icon: Workflow,
    title: "Workflows",
    body: "Compose skills and sub-agents into multi-step workflows with branches and merges, designed visually and run on demand.",
  },
  {
    icon: Wrench,
    title: "A real tool catalogue",
    body: "Web search, fetch, transforms, and your own tools — agents pick from a catalogue you control, scoped to what each job needs.",
  },
  {
    icon: ScrollText,
    title: "Every invocation audited",
    body: "Sub-agent calls, tool usage, and outputs all land on the same append-only log as everything else. Nothing runs in the dark.",
  },
];

export default function SkillsAndAgentsPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Skills & agents"
        title="Reusable skills. Orchestrated agents. All governed."
        description="Turn capabilities into skills your agents call, fan work out to sub-agents in fresh context windows, and automate runs — while every write still passes through the trust gate."
        ctaPrimary={{ label: "Start free", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "Explore the platform", href: "/features" }}
      />

      {/* Orchestration split */}
      <MarketingSection className="border-b border-border/30">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeader
            eyebrow="Orchestration"
            title="Deep work, lean context."
            lede="An orchestrator delegates to sub-agents, each running in its own fresh context window. Complex tasks stay coherent and cheap — and every sub-agent answers to the same trust gate."
          />
          {/* Fan-out visual */}
          <BentoCard>
            <div className="flex flex-col items-center gap-5">
              <div className="flex items-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5">
                <Sparkles className="size-4 text-violet-500" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">Orchestrator</span>
              </div>
              <div className="flex w-full items-start justify-center gap-3">
                {[
                  { label: "Research", icon: GitFork },
                  { label: "Draft", icon: Bot },
                  { label: "Review", icon: Puzzle },
                ].map((s) => {
                  const Icon = s.icon;
                  return (
                    <div key={s.label} className="flex flex-1 flex-col items-center gap-2">
                      <span className="h-5 w-px bg-border/70" />
                      <div className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-card/70 px-2 py-3">
                        <Icon className="size-4 text-violet-500" aria-hidden="true" />
                        <span className="text-[11px] font-medium text-foreground/80">{s.label}</span>
                        <span className="font-mono text-[9px] text-muted-foreground/50">fresh ctx</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </BentoCard>
        </div>
      </MarketingSection>

      {/* Capabilities bento */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader
          eyebrow="What you can build"
          title="From a single skill to a full workflow."
        />
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

      {/* Collaboration */}
      <CollabSection
        title="Work alongside your agents."
        lede="Agents and humans share one governed context — they propose, you review and refine, together in real time."
      />

      {/* CTA */}
      <MatrixCta
        title="Give your agents real capabilities — safely."
        subtitle="Build your first skill free. The trust gate stays closed until you open it."
        primary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
      />
    </div>
  );
}
