"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { FitScale } from "./fit-scale";

/**
 * An agent run over MCP: the tools it calls, in the order it calls them.
 * Adapted from ForgeUI "Workflow Run"; the dashed connectors, pill positions
 * and the ten-spoke spinner are the original's. The pills are named by the
 * tool alone: a glyph beside a label that already says the word would be a
 * rule 8 finding.
 */
const PILL =
  "inline-flex items-center whitespace-nowrap rounded-full border border-border bg-raised px-5 py-3 shadow-elev-1";

const NAME = "t-mk-ill-mono-12 text-ink";
const META = "t-mk-ill-12 text-ink-3";
const MONO = "t-mk-ill-mono-12 text-ink-3";

const JOB_W = 140;
const FOLLOW_W = 118;

function Spinner() {
  return (
    <span className="relative inline-block size-[16px] text-ink-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          data-mk-motion=""
          className="wf-spin absolute top-1/2 left-1/2 w-[4px] rounded-full bg-current"
          style={{
            height: 1.5,
            transform: `translate(-50%, -50%) rotate(${i * 36}deg) translate(146%)`,
            animationDelay: `${-900 + i * 100}ms`,
          }}
        />
      ))}
    </span>
  );
}

export function WorkflowRun({ className }: { className?: string }) {
  return (
    <div className={className}>
      <FitScale width={400} height={300}>
        <style>{`
          @keyframes wf-spin { 0% { opacity: 1; } 100% { opacity: 0.15; } }
          .wf-spin { animation: wf-spin 1s linear infinite; }
        `}</style>

        <div className="relative h-full w-full">
          <div
            className="absolute"
            style={{ left: 34, top: 20, width: 330, height: 264 }}
          >
            <svg
              aria-hidden="true"
              width={330}
              height={264}
              viewBox="0 0 330 264"
              fill="none"
              className="absolute inset-0"
            >
              <g
                stroke="var(--line-strong)"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeDasharray="1.5 6"
              >
                <path d="M22 30 V60 Q22 72 34 72 H42" />
                <path d="M56 86 V117 Q56 129 68 129 H82" />
                <path d="M56 86 V175 Q56 187 68 187 H82" />
                <path d="M56 86 V233 Q56 245 68 245 H82" />
                <path d="M220 129 H244" />
                <path d="M220 245 H244" />
              </g>
            </svg>

            <div
              className={cn(PILL, "absolute gap-4")}
              style={{ left: 8, top: 0 }}
            >
              <span className={NAME}>config_pull</span>
              <span className={MONO}>a3f9c1e</span>
            </div>

            <div
              className={cn(PILL, "absolute gap-4")}
              style={{ left: 40, top: 56 }}
            >
              <span className={NAME}>document_get</span>
              <span className={META}>marketing/icp</span>
            </div>

            <div
              className={cn(PILL, "absolute justify-between")}
              style={{ left: 80, top: 114, width: JOB_W }}
            >
              <span className={NAME}>document_put</span>
              <Spinner />
            </div>
            <div
              className={cn(PILL, "absolute gap-4")}
              style={{ left: 244, top: 114, width: FOLLOW_W }}
            >
              <span className={NAME}>branch_diff</span>
            </div>

            <div
              className={cn(PILL, "absolute justify-between")}
              style={{ left: 80, top: 172, width: JOB_W }}
            >
              <span className={NAME}>run_append</span>
              <Check
                className="size-[16px] text-positive-text"
                strokeWidth={2}
              />
            </div>

            <div
              className={cn(PILL, "absolute justify-between")}
              style={{ left: 80, top: 230, width: JOB_W }}
            >
              <span className={NAME}>feedback_add</span>
              <Spinner />
            </div>
            <div
              className={cn(PILL, "absolute gap-4")}
              style={{ left: 244, top: 230, width: FOLLOW_W }}
            >
              <span className={NAME}>branch_merge</span>
            </div>
          </div>
        </div>
      </FitScale>
    </div>
  );
}
