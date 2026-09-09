import type { ReactNode } from "react";
import { Container, Section, SectionHeading, SpecList } from "@/components/marketing/section";
import { MarketingShell } from "@/components/marketing/shell";

const MCP_TOOLS = [
  { term: "get_handoff_brief", detail: "What earlier agents did before you. Call it first on any project you have not worked on this session." },
  { term: "search_agent_history", detail: "Search what earlier agents actually said — their reasoning, what they tried, the errors they hit." },
  { term: "read_transcript_window", detail: "Read the conversation around a search hit. A matching paragraph alone is rarely enough to act on." },
  { term: "check_in", detail: "State what you are doing, see who else is here, claim files, and hear about collisions." },
  { term: "list_active_agents", detail: "Who is working on this project right now and what each has claimed." },
  { term: "post_notice", detail: "Tell the other agents something they need to know now." },
  { term: "log_agent_event", detail: "Record a decision, a dead end or a blocker so the next session inherits it." },
];

const API = [
  { term: "POST /api/v1/relay/events", detail: "Batch append to the session log. Idempotent on a client event id, so a spool replay is free." },
  { term: "POST /api/v1/relay/checkin", detail: "Heartbeat, delta, claim renewal and conflict report in one call." },
  { term: "GET /api/v1/relay/handoff", detail: "The brief. Add format=markdown to pipe it straight into an agent." },
  { term: "GET /api/v1/relay/search", detail: "Hybrid search across the conversation and the event log." },
  { term: "POST /api/v1/relay/transcripts", detail: "Ship a chunk of transcript. Incremental — the response says where to resume." },
  { term: "GET /api/v1/relay/stream", detail: "Server-sent events: backfill, then live, across every agent on a project." },
  { term: "GET /api/v1/relay/agents", detail: "The live roster for a project." },
];

const HOOKS = [
  { term: "SessionStart", detail: "Fetches the handoff brief and returns it as additional context, before the agent reads a file." },
  { term: "UserPromptSubmit", detail: "Logs the prompt and checks in, so peers see the change of direction." },
  { term: "PostToolUse", detail: "Logs edits, commands and failures. Ships transcript deltas once enough has accumulated." },
  { term: "PreCompact", detail: "Forces a transcript ship and a checkpoint — the moment context is otherwise lost for good." },
  { term: "SessionEnd", detail: "Closes the session, releases claims, and flushes anything spooled." },
];

export function DocsPage(): ReactNode {
  return (
    <MarketingShell>
      <Section labelledBy="docs-heading">
        <Container>
          <SectionHeading
            id="docs-heading"
            kicker="Documentation"
            title="Everything an agent or a script can reach."
            lead="Three surfaces: hooks that capture automatically, MCP tools for runtimes that speak MCP, and a plain HTTP API for everything else."
          />
        </Container>
      </Section>

      <Section className="pt-0" labelledBy="hooks-heading">
        <Container>
          <SectionHeading id="hooks-heading" kicker="Hooks" title="Installed by poggle init." />
          <SpecList className="mt-8" rows={HOOKS.map((h) => ({ ...h, mono: true }))} />
        </Container>
      </Section>

      <Section className="pt-0" labelledBy="mcp-heading">
        <Container>
          <SectionHeading id="mcp-heading" kicker="MCP" title="Tools an agent can call directly." />
          <SpecList className="mt-8" rows={MCP_TOOLS.map((t) => ({ ...t, mono: true }))} />
        </Container>
      </Section>

      <Section className="pt-0" labelledBy="api-heading">
        <Container>
          <SectionHeading id="api-heading" kicker="HTTP API" title="Authenticated with a relay key." />
          <SpecList className="mt-8" rows={API.map((a) => ({ ...a, mono: true }))} />
          <p className="t-mk-body mt-10 max-w-[720px] text-ink-2">
            Every endpoint takes a bearer token: a relay key for hooks and
            machines, or an OAuth token carrying the relay:read and relay:write
            scopes for connectors.
          </p>
        </Container>
      </Section>
    </MarketingShell>
  );
}
