export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  agent_type: "reasoning" | "research" | "synthesis" | "planning" | "coding" | "custom";
  tags: string[];
  system_prompt: string;
  source_content: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "research-assistant",
    name: "Research Assistant",
    description: "Searches your notes for relevant context, synthesizes findings, and drafts a structured research brief.",
    agent_type: "research",
    tags: ["research", "synthesis"],
    system_prompt: "You are a research assistant. Search the workspace for notes related to the user's query, synthesize the key ideas, and present a clear, structured summary with supporting references.",
    source_content: "# Research Assistant\n\nSearch workspace notes → synthesize findings → draft structured brief.\n\n## Inputs\n- Research question or topic\n\n## Output\n- Executive summary\n- Key findings with note references\n- Open questions",
  },
  {
    id: "meeting-summarizer",
    name: "Meeting Summarizer",
    description: "Takes raw meeting notes and produces a clean summary with decisions, action items, and owners.",
    agent_type: "synthesis",
    tags: ["meetings", "summaries"],
    system_prompt: "You are a meeting notes specialist. Given raw meeting notes, extract: (1) key decisions made, (2) action items with owners and due dates, (3) a 3-sentence executive summary. Format output as clean markdown.",
    source_content: "# Meeting Summarizer\n\nProcess raw meeting notes → structured output.\n\n## Output format\n- **Summary** (3 sentences)\n- **Decisions** (bullet list)\n- **Action items** (owner, deadline, description)",
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    description: "Reviews a note for clarity, structure, and impact. Suggests specific edits and rewrites weak sections.",
    agent_type: "reasoning",
    tags: ["writing", "editing"],
    system_prompt: "You are a writing coach. Review the provided note for: clarity of argument, logical structure, conciseness, and impact of the opening paragraph. Provide specific, actionable feedback with inline suggestions.",
    source_content: "# Writing Coach\n\nReview note → provide structured feedback.\n\n## Review dimensions\n- Clarity of argument\n- Logical structure  \n- Conciseness\n- Opening impact\n\n## Output\n- Overall assessment\n- Specific improvement suggestions\n- Rewritten samples where needed",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews code notes or snippets for correctness, security issues, and style. Suggests improvements.",
    agent_type: "coding",
    tags: ["code", "review"],
    system_prompt: "You are a senior code reviewer. Review the provided code for: correctness, security vulnerabilities, performance issues, and readability. Provide specific feedback with corrected code examples.",
    source_content: "# Code Reviewer\n\nReview code → structured critique.\n\n## Review checklist\n- Correctness\n- Security vulnerabilities\n- Performance\n- Readability and maintainability\n\n## Output\n- Issues found (severity: high/medium/low)\n- Corrected code snippets",
  },
  {
    id: "weekly-digest",
    name: "Weekly Digest",
    description: "Scans all notes updated in the past 7 days and compiles a digest of what changed, what was learned, and what needs attention.",
    agent_type: "synthesis",
    tags: ["digest", "weekly"],
    system_prompt: "You are a weekly digest compiler. Find all notes updated in the past 7 days across the workspace. Summarize: what was worked on, key insights captured, and items that need follow-up. Format as a readable digest.",
    source_content: "# Weekly Digest\n\nScan recent notes → compile weekly summary.\n\n## Sections\n- What was worked on (by box)\n- Key insights captured\n- Items needing follow-up\n- Recommended next actions",
  },
  {
    id: "idea-expander",
    name: "Idea Expander",
    description: "Takes a short idea or hypothesis and expands it into a full exploration: background, implications, counterarguments, and next steps.",
    agent_type: "planning",
    tags: ["ideas", "planning"],
    system_prompt: "You are an idea development specialist. Take the seed idea provided and expand it into a full exploration covering: background context, core hypothesis, key implications, strongest counterarguments, and concrete next steps to test the idea.",
    source_content: "# Idea Expander\n\nSeed idea → full exploration document.\n\n## Structure\n- Background context\n- Core hypothesis\n- Key implications\n- Counterarguments\n- Next steps to validate",
  },
];
