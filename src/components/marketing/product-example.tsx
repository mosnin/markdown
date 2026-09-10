import type { ReactNode } from "react";
import { Mark } from "@/components/brand/logo";
import { RevisionTimeline } from "./illustrations/timeline";
import { ChatThread } from "./illustrations/chatthread";
import { DataPipeline } from "./illustrations/data-pipeline";
import { ModelMesh } from "./illustrations/model-mesh";

/** Licensed ForgeUI scenes in the editorial slots, captioned for Poggle.
 * Page structure and captions stay independent of the animation choreography. */
const examples = {
  history: {
    title: "Session log / What the agent actually did",
    caption:
      "Every prompt, edit, command and decision, in order, with the ones that matter scored highest.",
    scene: <RevisionTimeline />,
  },
  brain: {
    title: "Handoff brief / What the next agent reads first",
    caption:
      "Assembled from the sessions before it and sized to a token budget, injected before it opens a file.",
    scene: <ChatThread variant="knowledge" />,
  },
  agents: {
    title: "Roster / Three agents, one repository",
    caption:
      "Who is working, what they are touching, and which files are already claimed.",
    scene: <ModelMesh />,
  },
  import: {
    title: "Transcript / The conversation itself",
    caption:
      "Reasoning is kept whole; tool output is cut to its head and tail. What cannot be reconstructed survives.",
    scene: <DataPipeline />,
  },
} satisfies Record<
  string,
  { title: string; caption: string; scene: ReactNode }
>;

export function ProductExample({ kind }: { kind: keyof typeof examples }) {
  const example = examples[kind];
  return (
    <figure
      className="overflow-hidden rounded-12 border border-border bg-raised"
      data-product-example={kind}
      data-licensed-illustration="forgeui"
    >
      <div className="flex items-center gap-3 border-b border-hairline px-6 py-4">
        <Mark size={16} />
        <span className="t-caption text-ink-2">
          Acme Robotics · Example workspace
        </span>
      </div>
      <figcaption className="px-6 pt-6 sm:px-8">
        <p className="t-caption text-ink-3">{example.title}</p>
        <p className="t-body mt-3 text-ink-2">{example.caption}</p>
      </figcaption>
      <div
        className="pointer-events-none flex min-h-[320px] items-center py-6 sm:min-h-[360px]"
        inert
        aria-hidden="true"
      >
        <div className="w-full">{example.scene}</div>
      </div>
    </figure>
  );
}
