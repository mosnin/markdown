import type { ReactNode } from "react";
import { Mark } from "@/components/brand/logo";
import { CodePresence } from "./illustrations/codepresence";
import { RevisionTimeline } from "./illustrations/timeline";
import { ChatThread } from "./illustrations/chatthread";
import { DataPipeline } from "./illustrations/data-pipeline";
import { NotificationStack } from "./illustrations/notification-stack";
import { MetricsChart } from "./illustrations/metricschart";
import { ModelMesh } from "./illustrations/model-mesh";
import { WorkflowRun } from "./illustrations/workflowrun";
import { ExportFlow } from "./illustrations/export-flow";

/** Licensed ForgeUI scenes in the existing editorial slots. Keep the page
 * structure and readable captions independent of the animation choreography. */
const examples = {
  profile: {
    title: "Marketing / Ideal customer profile",
    caption:
      "Capture your audience, their problems and what prompts them to buy.",
    scene: <CodePresence />,
  },
  history: {
    title: "Company documents / History",
    caption:
      "Every saved change keeps its author, message and earlier version.",
    scene: <RevisionTimeline />,
  },
  branch: {
    title: "Branches / Customer research",
    caption: "Propose an update on a branch, then review it before merging.",
    scene: <ChatThread />,
  },
  import: {
    title: "Import / Customer interview notes",
    caption:
      "Source material becomes proposed documents on a branch for review.",
    scene: <DataPipeline />,
  },
  inbox: {
    title: "Inbox / Needs your attention",
    caption:
      "Find drafts to review, overdue documents and connections needing attention.",
    scene: <NotificationStack variant="inbox" />,
  },
  metrics: {
    title: "Help desk / Ticket activity",
    caption:
      "Example ticket trends. App metrics are calculated from the records your team maintains.",
    scene: <MetricsChart />,
  },
  shared: {
    title: "Company context / Shared across departments",
    caption:
      "Departments work from shared documents instead of separate copies.",
    scene: <ModelMesh />,
  },
  agents: {
    title: "Agent access / A connected assistant",
    caption:
      "An example MCP workflow. Each read, write or merge requires the corresponding access.",
    scene: <WorkflowRun />,
  },
  export: {
    title: "Settings / Your data",
    caption:
      "Download JSON with history, or Markdown documents and CSV tables.",
    scene: <ExportFlow />,
  },
  brain: {
    title: "Brain / Company knowledge",
    caption:
      "Ask about indexed company knowledge using Stored and your configured AI provider.",
    scene: <ChatThread variant="knowledge" />,
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
