import CollabCard from "@/components/animata/card/collab-card";
import {
  MarketingSection,
  SectionHeader,
} from "@/components/marketing/sections";

// ─── Collaboration section ───────────────────────────────────────────────────
//
// A visual of the agent + human working the same context in real time — live
// presence, cursors, and the two of you "in sync". Reusable across pages with
// page-specific copy on the left and the animated CollabCard on the right.

export function CollabSection({
  eyebrow = "Collaboration",
  title,
  lede,
  muted = false,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <MarketingSection muted={muted} className="border-b border-border/30">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <SectionHeader eyebrow={eyebrow} title={title} lede={lede} />
        <div className="mx-auto w-full max-w-md">
          <CollabCard
            eyebrow="Agent + human, one source of truth"
            liveLabel="Live · agent + you"
            intro="editing"
            conjunction="&"
            greeting="in sync"
            collaborators={[
              {
                name: "Claude",
                pill: "bg-violet-600",
                pillText: "text-white",
                cursor: "text-violet-400",
              },
              {
                name: "You",
                pill: "bg-sky-500",
                pillText: "text-white",
                cursor: "text-sky-400",
              },
            ]}
            presenceColors={["#7c5cff", "#38bdf8", "#34d399", "#f472b6"]}
            extraCount={2}
          />
        </div>
      </div>
    </MarketingSection>
  );
}
