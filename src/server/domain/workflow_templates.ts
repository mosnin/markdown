import type { WorkflowGraphInput } from "@/server/domain/types/workflow";

export type WorkflowTemplateCategory =
  | "research"
  | "content"
  | "monitoring"
  | "automation";

export interface WorkflowTemplate {
  /** Stable slug used as the template id (URL-safe). */
  id: string;
  /** Human-readable name used as the default workflow name on clone. */
  name: string;
  /** One- or two-sentence description shown in the gallery. */
  description: string;
  /** Category pill shown on the gallery card. */
  category: WorkflowTemplateCategory;
  /** Emoji shown on the gallery card. */
  icon: string;
  /** Full graph snapshot copied into a fresh workflow on clone. */
  graph: WorkflowGraphInput;
}

// ─── Templates ────────────────────────────────────────────────────────────────
//
// Each template's graph must satisfy validateWorkflowGraph:
//   - unique node_keys
//   - exactly one "start" node
//   - every edge endpoint references an existing node_key
//   - DAG (no cycles)
//   - per-node config fields of the right shape
//
// Positions are laid out left-to-right (x += 250) starting at x=50, y=200.
// Parallel branches are offset by y: ±120.

const DAILY_NEWS_DIGEST: WorkflowTemplate = {
  id: "news-digest",
  name: "Daily news digest",
  description:
    "Search the web for today's top AI news and summarise it into a tidy bullet list.",
  category: "content",
  icon: "📰",
  graph: {
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        position: { x: 50, y: 200 },
        config: {},
      },
      {
        node_key: "search_news",
        node_type: "web_search",
        position: { x: 300, y: 200 },
        config: {
          query_template: "AI news from today",
          provider: "exa",
          num_results: 10,
        },
      },
      {
        node_key: "summarise",
        node_type: "transform",
        position: { x: 550, y: 200 },
        config: {
          system_prompt:
            "You are a concise editor. Produce a Markdown bullet list of the most important stories, one line each, with source links when available.",
          user_prompt_template:
            "Summarise these search results into a bullet list of the top stories:\n\n{{search_news.results}}",
          model: "gpt-4o",
        },
      },
      {
        node_key: "end",
        node_type: "end",
        position: { x: 800, y: 200 },
        config: {},
      },
    ],
    edges: [
      { source_node_key: "start", target_node_key: "search_news" },
      { source_node_key: "search_news", target_node_key: "summarise" },
      { source_node_key: "summarise", target_node_key: "end" },
    ],
  },
};

const COMPETITOR_MONITOR: WorkflowTemplate = {
  id: "competitor-monitor",
  name: "Competitor monitor",
  description:
    "Fetch a competitor's pricing page and call out any changes compared to the previous snapshot.",
  category: "monitoring",
  icon: "👀",
  graph: {
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        position: { x: 50, y: 200 },
        config: {},
      },
      {
        node_key: "fetch_pricing",
        node_type: "web_fetch",
        position: { x: 300, y: 200 },
        config: {
          url_template: "https://example.com/pricing",
        },
      },
      {
        node_key: "diff_pricing",
        node_type: "transform",
        position: { x: 550, y: 200 },
        config: {
          system_prompt:
            "You are a pricing analyst. Extract each tier's name and monthly price, and flag any changes versus the previous run.",
          user_prompt_template:
            "Here is the latest pricing page HTML. Extract the current tiers and note any deltas versus the previous snapshot you were shown.\n\n{{fetch_pricing.body}}",
          model: "gpt-4o",
        },
      },
      {
        node_key: "end",
        node_type: "end",
        position: { x: 800, y: 200 },
        config: {},
      },
    ],
    edges: [
      { source_node_key: "start", target_node_key: "fetch_pricing" },
      { source_node_key: "fetch_pricing", target_node_key: "diff_pricing" },
      { source_node_key: "diff_pricing", target_node_key: "end" },
    ],
  },
};

const RESEARCH_ASSISTANT: WorkflowTemplate = {
  id: "research-assistant",
  name: "Research assistant",
  description:
    "Search the web on a topic, extract key facts, then hand the top results to a sub-agent for a deeper dive.",
  category: "research",
  icon: "🔬",
  graph: {
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        position: { x: 50, y: 200 },
        config: {},
      },
      {
        node_key: "search_topic",
        node_type: "web_search",
        position: { x: 300, y: 200 },
        config: {
          query_template: "{{topic}} overview",
          provider: "exa",
          num_results: 8,
        },
      },
      {
        node_key: "extract_facts",
        node_type: "transform",
        position: { x: 550, y: 200 },
        config: {
          system_prompt:
            "You are a research assistant. Pull out the 3 most important facts and their sources from the search results.",
          user_prompt_template:
            "Extract the top 3 facts and source URLs from these results:\n\n{{search_topic.results}}",
          model: "gpt-4o",
        },
      },
      {
        node_key: "deep_dive",
        node_type: "subagent",
        position: { x: 800, y: 200 },
        config: {
          // Placeholder — replace with a real skill id after cloning. The
          // graph validator requires a non-empty string so we use a clearly
          // fake token that fails at run time if left unchanged.
          skill_id: "REPLACE_ME_WITH_SKILL_ID",
          task_template:
            "Take these top 3 facts and produce a deeper briefing on each, including context, counter-evidence, and open questions:\n\n{{extract_facts.output}}",
        },
      },
      {
        node_key: "end",
        node_type: "end",
        position: { x: 1050, y: 200 },
        config: {},
      },
    ],
    edges: [
      { source_node_key: "start", target_node_key: "search_topic" },
      { source_node_key: "search_topic", target_node_key: "extract_facts" },
      { source_node_key: "extract_facts", target_node_key: "deep_dive" },
      { source_node_key: "deep_dive", target_node_key: "end" },
    ],
  },
};

const CONTENT_SUMMARIZER: WorkflowTemplate = {
  id: "content-summarizer",
  name: "Content summarizer",
  description:
    "Fetch a URL and condense the article into a crisp 200-word summary.",
  category: "content",
  icon: "📝",
  graph: {
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        position: { x: 50, y: 200 },
        config: {},
      },
      {
        node_key: "fetch_article",
        node_type: "web_fetch",
        position: { x: 300, y: 200 },
        config: {
          url_template: "{{url}}",
        },
      },
      {
        node_key: "condense",
        node_type: "transform",
        position: { x: 550, y: 200 },
        config: {
          system_prompt:
            "You are an editor. Rewrite the input as a single, self-contained summary of about 200 words. Keep the most important facts, drop fluff.",
          user_prompt_template:
            "Summarise this article in ~200 words:\n\n{{fetch_article.body}}",
          model: "gpt-4o",
        },
      },
      {
        node_key: "end",
        node_type: "end",
        position: { x: 800, y: 200 },
        config: {},
      },
    ],
    edges: [
      { source_node_key: "start", target_node_key: "fetch_article" },
      { source_node_key: "fetch_article", target_node_key: "condense" },
      { source_node_key: "condense", target_node_key: "end" },
    ],
  },
};

const MULTI_SOURCE_AGGREGATOR: WorkflowTemplate = {
  id: "multi-source-aggregator",
  name: "Multi-source aggregator",
  description:
    "Run two web searches and a page fetch in parallel, merge the results, then synthesise a unified brief.",
  category: "research",
  icon: "🧩",
  graph: {
    nodes: [
      {
        node_key: "start",
        node_type: "start",
        position: { x: 50, y: 200 },
        config: {},
      },
      // Parallel branch A (top)
      {
        node_key: "search_primary",
        node_type: "web_search",
        position: { x: 300, y: 80 },
        config: {
          query_template: "{{topic}} primary sources",
          provider: "exa",
          num_results: 5,
        },
      },
      // Parallel branch B (middle)
      {
        node_key: "search_analysis",
        node_type: "web_search",
        position: { x: 300, y: 200 },
        config: {
          query_template: "{{topic}} expert analysis",
          provider: "tavily",
          num_results: 5,
        },
      },
      // Parallel branch C (bottom)
      {
        node_key: "fetch_reference",
        node_type: "web_fetch",
        position: { x: 300, y: 320 },
        config: {
          url_template: "https://en.wikipedia.org/wiki/{{topic}}",
        },
      },
      {
        node_key: "merge_sources",
        node_type: "merge",
        position: { x: 550, y: 200 },
        config: {},
      },
      {
        node_key: "synthesise",
        node_type: "transform",
        position: { x: 800, y: 200 },
        config: {
          system_prompt:
            "You are a research synthesiser. Produce a single balanced brief that cites each source at least once and flags disagreements between sources.",
          user_prompt_template:
            "Combine the following into a unified brief:\n\nPrimary sources: {{search_primary.results}}\n\nExpert analysis: {{search_analysis.results}}\n\nReference: {{fetch_reference.body}}",
          model: "gpt-4o",
        },
      },
      {
        node_key: "end",
        node_type: "end",
        position: { x: 1050, y: 200 },
        config: {},
      },
    ],
    edges: [
      { source_node_key: "start", target_node_key: "search_primary" },
      { source_node_key: "start", target_node_key: "search_analysis" },
      { source_node_key: "start", target_node_key: "fetch_reference" },
      { source_node_key: "search_primary", target_node_key: "merge_sources" },
      { source_node_key: "search_analysis", target_node_key: "merge_sources" },
      { source_node_key: "fetch_reference", target_node_key: "merge_sources" },
      { source_node_key: "merge_sources", target_node_key: "synthesise" },
      { source_node_key: "synthesise", target_node_key: "end" },
    ],
  },
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  DAILY_NEWS_DIGEST,
  COMPETITOR_MONITOR,
  RESEARCH_ASSISTANT,
  CONTENT_SUMMARIZER,
  MULTI_SOURCE_AGGREGATOR,
] as const;

export function findWorkflowTemplateById(
  id: string
): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
