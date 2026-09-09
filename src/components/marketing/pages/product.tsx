import Link from "next/link";
import type { ReactNode } from "react";
import { ProductExample } from "@/components/marketing/product-example";
import {
  Container,
  FeatureRow,
  Section,
  SectionHeading,
  SpecList,
} from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

export function ProductPage(): ReactNode {
  return (
    <MarketingShell>
      <Section labelledBy="product-heading">
        <Container>
          <SectionHeading
            id="product-heading"
            kicker="Product"
            title="Four layers, one job: the next agent should not start cold."
            lead="Capture what agents do without anyone remembering to. Distil it into state worth carrying. Serve it to whoever comes next, sized to a budget. Tell everyone working right now what everyone else is doing."
          />
        </Container>
      </Section>

      <Section className="pt-0" labelledBy="log-heading">
        <Container className="flex flex-col gap-12">
          <FeatureRow
            id="log-heading"
            kicker="The session log"
            title="An append-only record of what happened."
            visual={<ProductExample kind="history" />}
          >
            <p>
              Every event carries a short summary — the line the next agent
              reads — the structured detail behind it, the files it touched, and
              a salience score from 0 to 5.
            </p>
            <p>
              Salience is the product&apos;s central opinion. A decision made an
              hour ago outranks a file read from a minute ago, so
              <code className="mk-code"> file_read</code> is 0 while
              <code className="mk-code"> decision</code>,
              <code className="mk-code"> blocker</code> and
              <code className="mk-code"> usage_limit</code> are 5. That is what
              makes a small brief useful rather than merely short.
            </p>
            <p>
              The log is append-only in the database, not just in the
              application. No interface can rewrite what an agent did.
            </p>
          </FeatureRow>

          <FeatureRow
            id="briefs-heading"
            kicker="Handoff briefs"
            title="Deterministic, budgeted, in priority order."
            reverse
            visual={<ProductExample kind="brain" />}
          >
            <p>
              No model call. The same log and the same budget produce the same
              brief, byte for byte — a brief you cannot reproduce is one you
              cannot debug, and an agent that gets a different story on each
              reconnect is worse off than one that gets none.
            </p>
            <p>
              The budget is spent from most to least valuable, so what survives
              a tight one is what a fresh agent would most regret not knowing.
            </p>
          </FeatureRow>

          <FeatureRow
            id="conversation-heading"
            kicker="The conversation"
            title="Not just what they concluded — what they said."
            visual={<ProductExample kind="import" />}
          >
            <p>
              A conclusion routes the next agent. Only the conversation explains
              why three approaches were abandoned, and that is the expensive
              thing to rediscover.
            </p>
            <p>
              Reasoning is stored whole, because it exists nowhere else once the
              process exits. Tool output is cut to its head and tail, because a
              file&apos;s contents are one tool call away. A failing result is
              promoted — it is the evidence for a dead end.
            </p>
            <p>
              Search runs over keywords and meaning together: exact identifiers
              are what agents actually look for and what embeddings are worst
              at, and the paraphrase is what keywords miss.
            </p>
          </FeatureRow>

          <FeatureRow
            id="coordination-heading"
            kicker="Live coordination"
            title="Several agents, one repo, no collisions."
            reverse
            visual={<ProductExample kind="agents" />}
          >
            <p>
              Agents check in as they work. One call states what they are doing,
              returns what changed since last time, renews their claims and
              reports conflicts.
            </p>
            <p>
              Claims are advisory and named accordingly — nothing can intercept
              another agent&apos;s edit tool, so the value is entirely in the
              other agent being told. They expire on their own, because an agent
              killed by a usage cap never releases anything.
            </p>
          </FeatureRow>
        </Container>
      </Section>

      <Section labelledBy="hooks-heading">
        <Container>
          <SectionHeading
            id="hooks-heading"
            kicker="Hooks"
            title="Capture is automatic, or it does not happen."
            lead="If using Poggle requires discipline, it will not be used at the moment it matters — because that moment is always mid-task and under pressure."
          />
          <SpecList
            className="mt-10"
            rows={[
              {
                term: "Claude Code",
                detail:
                  "SessionStart, UserPromptSubmit, PostToolUse, PreCompact and SessionEnd. SessionStart is the one that matters: it returns the brief as additional context, so a fresh agent starts already knowing.",
              },
              {
                term: "Codex CLI",
                detail: "Through its notify hook, wired by the installer.",
              },
              {
                term: "Git",
                detail:
                  "A post-commit hook, so commits land in the log even with no agent running.",
              },
              {
                term: "Anything else",
                detail:
                  "One documented endpoint and a zero-dependency CLI, for Cursor, custom harnesses and CI.",
              },
              {
                term: "MCP",
                detail:
                  "get_handoff_brief, search_agent_history, check_in and more, for runtimes that speak MCP but have no hooks.",
              },
            ]}
          />
          <p className="t-mk-body mt-10 max-w-[720px] text-ink-2">
            <Link href="/docs" className="t-link">
              Read the documentation
            </Link>{" "}
            for the full hook, MCP and API reference.
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
