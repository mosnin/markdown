import Link from "next/link";
import type { ReactNode } from "react";
import { CutButton } from "@/components/marketing/cut-button";
import { Hero } from "@/components/marketing/hero";
import { ProductExample } from "@/components/marketing/product-example";
import {
  Container,
  FeatureRow,
  Section,
  SectionHeading,
  SpecList,
  StatStrip,
} from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

export function HomePage(): ReactNode {
  return (
    <MarketingShell>
      <Hero />

      <Section labelledBy="problem-heading">
        <Container>
          <SectionHeading
            id="problem-heading"
            kicker="The problem"
            title="Context dies with the session that produced it."
            lead="You run several coding agents against one repo — Claude Code on one plan, Codex on another, a teammate's Cursor. Three hours in, one hits a usage cap. You switch to the next one, and it knows nothing: not the goal, not which approach already failed twice, not that the migration was written but never run."
          />
          <SpecList
            className="mt-10"
            rows={[
              {
                term: "CLAUDE.md and AGENTS.md",
                detail:
                  "Static and hand-maintained. They describe the repo, not what is happening in it right now, and nobody updates them mid-task.",
              },
              {
                term: "The agent's own context",
                detail:
                  "Dies with the process, and is compacted away long before that.",
              },
              {
                term: "--continue and --resume",
                detail:
                  "Same tool, same account, same machine. Useless the moment you switch plans or agents.",
              },
              {
                term: "Telling the next agent yourself",
                detail:
                  "You are the bottleneck, you are working from memory, and you forget.",
              },
            ]}
          />
        </Container>
      </Section>

      <Section className="pt-0" labelledBy="loop-heading">
        <Container className="flex flex-col gap-12">
          <FeatureRow
            id="loop-heading"
            kicker="1. Capture"
            title="Hooks log what your agents do, as they do it."
            visual={<ProductExample kind="history" />}
          >
            <p>
              Claude Code already hands a hook every prompt, every tool call and
              the path to its full transcript. Poggle installs those hooks and
              listens: prompts, edits, commands, test runs, commits, decisions,
              blockers and caps, logged without anyone remembering to.
            </p>
            <p>
              Codex, Cursor, CI and anything else reach the same log through a
              documented endpoint and a zero-dependency CLI. Events spool to
              disk before they are sent, so an agent killed mid-call still
              reports what it was doing.
            </p>
            <Link href="/product#log" className="t-link w-fit">
              How capture works
            </Link>
          </FeatureRow>

          <FeatureRow
            id="brief-heading"
            kicker="2. Hand off"
            title="The next agent starts knowing what the last one knew."
            reverse
            visual={<ProductExample kind="brain" />}
          >
            <p>
              At session start, the next agent gets a brief — assembled from
              what came before, sized to a token budget, injected into its
              context before it reads a single file.
            </p>
            <p>
              What survives a tight budget is what an agent would most regret
              not knowing: why the last session stopped, what is blocked and
              already failed, decisions taken, what was left half-applied. Files
              touched come last — an agent can read the repo, but it cannot
              recover a decision nobody wrote down.
            </p>
            <Link href="/product#briefs" className="t-link w-fit">
              What is in a brief
            </Link>
          </FeatureRow>

          <FeatureRow
            id="coordination-heading"
            kicker="3. Work together"
            title="Several agents on one repo, without collisions."
            visual={<ProductExample kind="agents" />}
          >
            <p>
              Agents check in as they work: stating what they are doing, seeing
              who else is here, and claiming the files they are about to change.
              When someone edits a file you claimed, you are told at your next
              check-in — a collision you hear about now is a merge conflict you
              do not get later.
            </p>
            <p>
              Claims expire on their own, because an agent killed by a usage cap
              never releases anything. Webhooks carry the moments a human should
              see: an agent capped mid-task, two agents wanting the same file.
            </p>
            <Link href="/product#coordination" className="t-link w-fit">
              How coordination works
            </Link>
          </FeatureRow>
        </Container>
      </Section>

      <Section labelledBy="numbers-heading">
        <Container>
          <SectionHeading
            id="numbers-heading"
            align="center"
            title="Built for what agents actually produce."
          />
          <StatStrip
            className="mt-12"
            items={[
              {
                value: "93%",
                label: "smaller",
                detail:
                  "A transcript is stored at a fraction of its size, keeping every piece of reasoning and cutting the tool output you can re-run.",
              },
              {
                value: "0",
                label: "model calls per brief",
                detail:
                  "Brief assembly is deterministic. The same log and budget produce the same brief, byte for byte.",
              },
              {
                value: "~2s",
                label: "hook budget",
                detail:
                  "Every call is timeout-bounded and exits clean. A relay outage is invisible to the person coding.",
              },
            ]}
          />
        </Container>
      </Section>

      <Section className="pt-0" labelledBy="start-heading">
        <Container className="flex flex-col items-center gap-8 text-center">
          <SectionHeading
            id="start-heading"
            align="center"
            title="Two commands, and the context carries itself."
            lead="Create a relay key, run poggle init in your repo, and start an agent. Everything after that is automatic."
          />
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CutButton href="/sign_in" size="lg">
              Start free
            </CutButton>
            <CutButton href="/docs" variant="outline" size="lg">
              Read the docs
            </CutButton>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
