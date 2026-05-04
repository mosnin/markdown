/**
 * Synthetic prompt → agent-run scripts that back the marketing
 * <LiveAgentDemo />. Each entry is a deterministic finite-state-machine
 * transcript: the visitor picks (or types) one of these prompts and the
 * UI replays the steps with realistic timing.
 *
 * No server calls, no model — just a believable canned run grounded in
 * a "notes app" world (boxes, notes, summaries, follow-ups).
 */

export interface DemoToolCall {
  /** Function-call style label, e.g. `read_notes(box="Atlas")`. */
  signature: string;
  /** Short human-readable description of what the tool returned. */
  result: string;
}

export interface DemoResponse {
  /** Stable id, used as React key + suggestion lookup. */
  id: string;
  /** What the visitor sees on the suggested-prompt chip. */
  label: string;
  /** The full prompt inserted into the textarea on click. */
  prompt: string;
  /** One-line "thinking" plan that renders before the tool calls. */
  plan: string;
  /** 2–3 tool calls rendered as compact monospace chips. */
  toolCalls: DemoToolCall[];
  /** Final markdown-ish answer (3–5 sentences). Plain text + bullets only. */
  answer: string;
}

export const DEMO_RESPONSES: readonly DemoResponse[] = [
  {
    id: "atlas-summary",
    label: "Summarize my notes on Project Atlas",
    prompt: "Summarize my notes on Project Atlas",
    plan: "Locate the Atlas box, read the most recent notes, and synthesize the active threads.",
    toolCalls: [
      {
        signature: 'read_notes(box="Atlas", limit=8)',
        result: "8 notes · last updated 2h ago",
      },
      {
        signature: 'summarize(scope="recent_activity")',
        result: "3 active threads identified",
      },
    ],
    answer:
      "Project Atlas has three live threads. The migration plan is blocked on a final decision about Postgres versioning — the latest note from Tuesday flags a 14 vs. 16 split. The pricing model rewrite is in review with two open comments from Priya. Onboarding copy is shipped; the remaining task is the welcome email, currently a draft in `drafts/atlas/welcome.md`.",
  },
  {
    id: "weekly-followups",
    label: "Draft this week's follow-ups",
    prompt: "Draft this week's follow-ups from my meeting notes",
    plan: "Scan meeting notes from the last 7 days and extract every commitment with an owner.",
    toolCalls: [
      {
        signature: 'list_notes(folder="meetings", since="7d")',
        result: "12 meeting notes",
      },
      {
        signature: 'extract(pattern="action_item")',
        result: "9 action items, 4 owners",
      },
      {
        signature: 'group_by(field="owner")',
        result: "grouped into 4 sections",
      },
    ],
    answer:
      "Nine follow-ups across four owners. Yours: send the revised SLA to Acme by Thursday, confirm the design review slot with Mei, and circulate the Q3 roadmap one-pager. Priya owes the security questionnaire response. Jordan is waiting on legal for the DPA. Mei has the dashboard mock for Friday's review.",
  },
  {
    id: "find-related",
    label: "Find notes related to caching strategy",
    prompt: "Find notes across my workspace related to caching strategy",
    plan: "Search every box for caching-related notes and rank by recency and relevance.",
    toolCalls: [
      {
        signature: 'search(query="caching strategy", scope="workspace")',
        result: "14 matches across 5 boxes",
      },
      {
        signature: 'rank(by=["recency", "relevance"])',
        result: "top 5 surfaced",
      },
    ],
    answer:
      "Five strong matches. The Architecture box has `cache_layers.md` (updated yesterday) covering the CDN → edge → origin chain. Performance has two notes on Redis TTL tuning from the last sprint. The Atlas box has a decision record pinning us to write-through for billing. There is also a half-finished draft in Scratch comparing stale-while-revalidate vs. background refresh — worth promoting.",
  },
] as const;

/** Generic "I don't know that one" reply for free-form prompts. */
export const DEMO_FALLBACK = {
  plan: "Searching the demo dataset for a matching transcript.",
  toolCalls: [
    {
      signature: 'search_demo(prompt="…")',
      result: "no exact match",
    },
  ],
  answer:
    "This demo is limited to the suggested prompts above so every visitor sees a real, deterministic agent run. Sign up to point Poggle at your own notes — every prompt becomes a real run with real tool calls.",
} as const satisfies {
  plan: string;
  toolCalls: readonly DemoToolCall[];
  answer: string;
};
