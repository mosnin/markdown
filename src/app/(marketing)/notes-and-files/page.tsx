import type { Metadata } from "next";
import {
  Boxes,
  Download,
  FileText,
  FolderTree,
  History,
  Paperclip,
  Search,
  Tag,
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
  title: "Notes & files — Poggle",
  description:
    "Markdown-native notes, organized into boxes and folders, with version history, attachments, and search — a source of truth humans edit and agents can read.",
};

const FEATURES = [
  {
    icon: FileText,
    title: "Markdown-native",
    body: "Every note is plain markdown with structured front-matter. Readable by people, parseable by agents, portable forever.",
  },
  {
    icon: Boxes,
    title: "Boxes & folders",
    body: "Group related knowledge into boxes, nest with folders, and give each box agent instructions that scope how it's used.",
  },
  {
    icon: Paperclip,
    title: "Files & attachments",
    body: "Attach the source material — specs, exports, images — alongside the notes that reference them.",
  },
  {
    icon: History,
    title: "Version history",
    body: "Every edit is a version. Diff any two, restore any one, and see exactly who (or which agent) changed what.",
  },
  {
    icon: Search,
    title: "Full-text & semantic search",
    body: "Find a note by the words in it or by what it means. Agents retrieve the right context, not the closest string.",
  },
  {
    icon: Download,
    title: "Always portable",
    body: "Export your whole workspace as plain markdown anytime. No lock-in, no proprietary blob, no hostage situation.",
  },
];

export default function NotesAndFilesPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeroSection
        eyebrow="Notes & files"
        title="A source of truth, structured for humans and agents alike."
        description="Markdown notes organized into boxes, versioned on every edit, and searchable by meaning — the substrate your agents read from and propose against."
        ctaPrimary={{ label: "Start free", href: "/sign_in?mode=signup" }}
        ctaSecondary={{ label: "Explore the platform", href: "/features" }}
      />

      {/* Feature split */}
      <MarketingSection className="border-b border-border/30">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHeader
            eyebrow="Structure that lasts"
            title="Knowledge that doesn't rot."
            lede="Notes live in boxes with tags, summaries, and links — structure agents can navigate and humans actually maintain. It stays current because everyone, and every agent, works from the same place."
          />
          {/* Static box visual */}
          <BentoCard className="p-0">
            <div className="flex items-center gap-2 border-b border-border/50 px-5 py-3.5">
              <span className="flex size-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                <Boxes className="size-4" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium text-foreground">Engineering</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">12 notes</span>
            </div>
            <ul className="list-none divide-y divide-border/40 px-5">
              {[
                { t: "API Architecture", tag: "decision" },
                { t: "Caching strategy", tag: "decision" },
                { t: "Rate limits", tag: "spec" },
                { t: "Auth model", tag: "spec" },
              ].map((n) => (
                <li key={n.t} className="flex items-center gap-2.5 py-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="text-[13px] text-foreground/85">{n.t}</span>
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-500">
                    <Tag className="size-2.5" aria-hidden="true" />
                    {n.tag}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 border-t border-border/50 px-5 py-3 text-[11px] text-muted-foreground">
              <FolderTree className="size-3.5 text-violet-500" aria-hidden="true" />
              Nested folders · agent instructions · per-box scopes
            </div>
          </BentoCard>
        </div>
      </MarketingSection>

      {/* Capabilities bento */}
      <MarketingSection muted className="border-b border-border/30">
        <SectionHeader
          eyebrow="What you get"
          title="Everything a knowledge base should be."
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
        title="Edit together, live."
        lede="Live presence and cursors on every note — co-edit with your team while agents propose changes you approve."
      />

      {/* CTA */}
      <MatrixCta
        title="Build the knowledge base your agents deserve."
        subtitle="Free to start, plain markdown forever, yours to export anytime."
        primary={{ label: "Get started free", href: "/sign_in?mode=signup" }}
      />
    </div>
  );
}
